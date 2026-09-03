"use strict";

const crypto = require("node:crypto");

const {
  UNDERSTANDING_TURN_INPUT_SCHEMA_VERSION,
  MAX_SOURCE_EVENTS,
  MAX_RECENT_CONVERSATION,
  MAX_REFERENCEABLE_CYCLES,
  validateUnderstandingTurnInput
} = require("./contracts/understanding-turn-input");

const CATALOG_PROJECTION_BY_TURN_INPUT = new WeakMap();
const TRUSTED_CATALOG_PROJECTIONS = new WeakSet();

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function failure(code, errors, valueOriginFunction = "turn-input-adapter") {
  const error = new TypeError(`${code}:${errors.join(",")}`);
  error.code = code;
  error.validationErrors = errors;
  error.valueOriginFunction = valueOriginFunction;
  throw error;
}

function boundedText(value, limit = 160) {
  return typeof value === "string" && value.length > 0 && value.length <= limit;
}

function propertyScopeFrom(args) {
  const binding = args && args.verifiedPropertyBinding;
  const conversation = args && args.verifiedConversationScope;
  if (!binding || !boundedText(binding.propertyId)
    || !conversation || !boundedText(conversation.channel) || !boundedText(conversation.userId)) {
    failure("PROPERTY_SCOPE_INVALID", ["verified_property_scope_required"]);
  }
  if (boundedText(binding.channel) && binding.channel !== conversation.channel) {
    failure("PROPERTY_SCOPE_INVALID", ["binding_channel_conflict"]);
  }
  return {
    propertyId: binding.propertyId,
    channel: conversation.channel,
    userId: conversation.userId
  };
}

function assertPropertyClaim(propertyId, claim, path) {
  if (claim !== undefined && claim !== null && claim !== "" && claim !== propertyId) {
    failure("PROPERTY_SCOPE_INVALID", [path]);
  }
}

function assertNoForgedProperty(args, propertyId) {
  [
    [args.propertyId, "propertyId"],
    [args.queryPropertyId, "queryPropertyId"],
    [args.requestedPropertyId, "requestedPropertyId"],
    [args.query && args.query.propertyId, "query.propertyId"],
    [args.body && args.body.propertyId, "body.propertyId"]
  ].forEach(([claim, path]) => assertPropertyClaim(propertyId, claim, path));
  for (const [index, event] of (Array.isArray(args.sourceEvents) ? args.sourceEvents : []).entries()) {
    assertPropertyClaim(propertyId, event && event.propertyId, `sourceEvents.${index}.propertyId`);
    assertPropertyClaim(propertyId, event && event.customerId, `sourceEvents.${index}.customerId`);
    assertPropertyClaim(propertyId, event && event.query && event.query.propertyId, `sourceEvents.${index}.query.propertyId`);
  }
}

function catalogCategoryToSubjectKind(category) {
  return category === "transport" ? "external_place" : category;
}

function subjectKindToCatalogCategory(kind) {
  return kind === "external_place" ? "transport" : kind;
}

function projectEvent(event, includeCycleIds) {
  const projected = {
    eventId: event && event.eventId,
    messageRef: event && event.messageRef,
    role: event && event.role,
    timestamp: event && event.timestamp,
    messageKind: event && event.messageKind,
    messageText: event && event.messageText
  };
  if (includeCycleIds) {
    projected.referenceableCycleIds = event && event.referenceableCycleIds;
  }
  return projected;
}

function projectCycles(snapshot, propertyId) {
  if (!snapshot || typeof snapshot !== "object") {
    failure("TURN_INPUT_INVALID", ["stateV3Snapshot"], "projectCycles");
  }
  const scope = snapshot.scope;
  if (!scope || scope.propertyId !== propertyId) {
    failure("PROPERTY_SCOPE_INVALID", ["stateV3Snapshot.scope.propertyId"]);
  }
  if (!Array.isArray(snapshot.referenceableCycles)
    || snapshot.referenceableCycles.length > MAX_REFERENCEABLE_CYCLES) {
    failure("TURN_INPUT_INVALID", ["stateV3Snapshot.referenceableCycles"], "projectCycles");
  }
  return snapshot.referenceableCycles.map((cycle, index) => {
    assertPropertyClaim(propertyId, cycle && cycle.propertyId, `referenceableCycles.${index}.propertyId`);
    return {
      requestCycleId: cycle && cycle.requestCycleId,
      requestKind: cycle && cycle.requestKind,
      capability: cycle && cycle.capability,
      status: cycle && cycle.status,
      expiresAt: cycle && cycle.expiresAt,
      subject: cycle && cycle.subject && {
        kind: cycle.subject.kind,
        catalogIdentity: cycle.subject.catalogIdentity
      },
      missingFields: cycle && cycle.missingFields,
      confirmedValues: cycle && cycle.confirmedValues && {
        checkIn: cycle.confirmedValues.checkIn,
        checkOut: cycle.confirmedValues.checkOut,
        guestCount: cycle.confirmedValues.guestCount,
        searchFrom: cycle.confirmedValues.searchFrom,
        searchTo: cycle.confirmedValues.searchTo
      },
      slotRefs: cycle && cycle.slotRefs
    };
  });
}

function projectCatalog(catalog, propertyId) {
  if (!catalog || typeof catalog !== "object" || catalog.propertyId !== propertyId) {
    failure("PROPERTY_SCOPE_INVALID", ["publicCatalog.propertyId"]);
  }
  if (!Array.isArray(catalog.capabilityCatalog)
    || !Array.isArray(catalog.publicSubjectCatalog)) {
    failure("TURN_INPUT_INVALID", ["publicCatalog"], "projectCatalog");
  }
  return {
    propertyTimezone: catalog.timezone,
    capabilityCatalog: [...catalog.capabilityCatalog],
    publicSubjectCatalog: catalog.publicSubjectCatalog.map((subject, index) => {
      assertPropertyClaim(propertyId, subject && subject.propertyId, `publicSubjectCatalog.${index}.propertyId`);
      return {
        catalogIdentity: subject && subject.catalogIdentity,
        kind: subject && subject.kind,
        publicName: subject && subject.publicName
      };
    })
  };
}

function buildC01PublicCatalog(property, catalog, capabilityCatalog) {
  if (!property || !catalog || catalog.propertyId !== property.propertyId) {
    failure("PROPERTY_SCOPE_INVALID", ["publicCatalog.propertyId"]);
  }
  const subjects = [...catalog.rooms, ...catalog.amenities, ...catalog.policies].map((item) => ({
    catalogIdentity: item.canonicalId,
    kind: catalogCategoryToSubjectKind(item.category),
    propertyId: property.propertyId,
    publicName: item.publicName
  }));
  const roomsByType = new Map();
  for (const room of catalog.rooms) {
    if (room.category !== "room" || !room.type) continue;
    const rooms = roomsByType.get(room.type) || [];
    rooms.push(room);
    roomsByType.set(room.type, rooms);
  }
  for (const [roomType, rooms] of roomsByType) {
    if (rooms.length < 2) continue;
    const digest = crypto.createHash("sha256")
      .update(`${property.propertyId}\0${roomType}`, "utf8").digest("hex").slice(0, 24);
    subjects.push({
      catalogIdentity: `matched-room-set-${digest}`,
      kind: "matched_room_set",
      propertyId: property.propertyId,
      publicName: roomType
    });
  }
  return {
    propertyId: property.propertyId,
    timezone: catalog.timezone,
    capabilityCatalog: [...capabilityCatalog],
    publicSubjectCatalog: subjects
  };
}

function buildC01TrustedCanonicalizerCatalog(input, officialCatalog = null) {
  const officialRooms = officialCatalog && officialCatalog.propertyId === input.propertyScope.propertyId
    ? new Map((officialCatalog.rooms || []).map((item) => [item.canonicalId, item]))
    : new Map();
  const project = (subject) => {
    const official = subject.kind === "room" ? officialRooms.get(subject.catalogIdentity) : null;
    return {
      canonicalId: subject.catalogIdentity,
      category: subjectKindToCatalogCategory(subject.kind),
      publicName: subject.publicName,
      ...(official ? {
        type: official.type || "",
        aliases: Array.isArray(official.aliases) ? [...official.aliases] : []
      } : {})
    };
  };
  return {
    propertyId: input.propertyScope.propertyId,
    timezone: input.propertyTimezone,
    rooms: input.publicSubjectCatalog.filter((subject) => ["room", "bundle"].includes(subject.kind)).map(project),
    amenities: input.publicSubjectCatalog.filter((subject) => subject.kind === "amenity").map(project),
    policies: input.publicSubjectCatalog.filter((subject) => ["policy", "external_place"].includes(subject.kind)).map(project)
  };
}

function buildPublicCatalogIdentityProjection(understandingTurnInput) {
  const cached = CATALOG_PROJECTION_BY_TURN_INPUT.get(understandingTurnInput);
  if (cached) return cached;
  return null;
}

function isPublicCatalogIdentityProjection(value) {
  return Boolean(value) && typeof value === "object" && TRUSTED_CATALOG_PROJECTIONS.has(value);
}

function isPublicCatalogIdentityProjectionFor(understandingTurnInput, value) {
  return isPublicCatalogIdentityProjection(value)
    && CATALOG_PROJECTION_BY_TURN_INPUT.get(understandingTurnInput) === value;
}

function buildUnderstandingTurnInput(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    failure("TURN_INPUT_INVALID", ["args"], "buildUnderstandingTurnInput");
  }
  const propertyScope = propertyScopeFrom(args);
  assertNoForgedProperty(args, propertyScope.propertyId);
  if (!Array.isArray(args.sourceEvents) || args.sourceEvents.length < 1
    || args.sourceEvents.length > MAX_SOURCE_EVENTS) {
    failure("TURN_INPUT_INVALID", ["sourceEvents"], "buildUnderstandingTurnInput");
  }
  if (!Array.isArray(args.recentConversation)
    || args.recentConversation.length > MAX_RECENT_CONVERSATION) {
    failure("CONTEXT_WINDOW_INVALID", ["recentConversation"]);
  }
  const catalog = projectCatalog(args.publicCatalog, propertyScope.propertyId);
  const input = {
    schemaVersion: UNDERSTANDING_TURN_INPUT_SCHEMA_VERSION,
    coreVersion: args.coreVersion,
    traceId: args.traceId,
    turnId: args.turnId,
    propertyScope,
    sourceEvents: args.sourceEvents.map((event) => projectEvent(event, false)),
    recentConversation: args.recentConversation.map((event) => projectEvent(event, true)),
    referenceableCycles: projectCycles(args.stateV3Snapshot, propertyScope.propertyId),
    ...catalog
  };
  const validation = validateUnderstandingTurnInput(input);
  if (!validation.ok) failure(validation.code, validation.errors, "validateUnderstandingTurnInput");
  const frozenInput = deepFreeze(input);
  const catalogProjection = deepFreeze(frozenInput.publicSubjectCatalog.map((subject) => [
    subject.catalogIdentity,
    subject.kind
  ]));
  CATALOG_PROJECTION_BY_TURN_INPUT.set(frozenInput, catalogProjection);
  TRUSTED_CATALOG_PROJECTIONS.add(catalogProjection);
  return frozenInput;
}

module.exports = {
  buildC01PublicCatalog,
  buildC01TrustedCanonicalizerCatalog,
  buildUnderstandingTurnInput,
  buildPublicCatalogIdentityProjection,
  catalogCategoryToSubjectKind,
  isPublicCatalogIdentityProjection,
  isPublicCatalogIdentityProjectionFor,
  subjectKindToCatalogCategory
};
