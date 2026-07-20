"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { openPostgres } = require("./postgres-client");
const { validateFriendlyProperty } = require("../friendly-property-import");
const { validateAvailabilityDays, STATUS_MAP } = require("../availability-days-import");

async function seedPostgres(connection) {
  const root = path.resolve(__dirname, "../..");
  const property = validateFriendlyProperty(JSON.parse(fs.readFileSync(path.join(root, "fixtures/nephi-home-property.json"), "utf8")));
  const availability = validateAvailabilityDays(JSON.parse(fs.readFileSync(path.join(root, "fixtures/nephi-home-availability-2026-07-14-to-2026-08-31.json"), "utf8")));
  const client = await openPostgres(connection);
  try {
    const existing = await client.query("SELECT property_id FROM properties WHERE property_id=$1", [property.propertyId]);
    if (existing.rows.length) {
      await materializeCanonicalKnowledgeKeys(client, property);
      await ensureNephiBundle(client, property.propertyId);
      return { seeded: false, propertyId: property.propertyId };
    }
    await client.query("BEGIN");
    await client.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2)", [property.propertyId, property.name]);
    for (let i = 0; i < property.rooms.length; i += 1) {
      const room = property.rooms[i];
      await client.query("INSERT INTO room_types(property_id,room_id,name,capacity,type,description,position) VALUES($1,$2,$3,$4,$5,$6,$7)", [property.propertyId, room.id, room.name, room.capacity, room.type, room.description, i]);
    }
    const settings = { commonAnswers: property.safeFacts, pricing: property.pricing, humanHandoffSituations: property.humanHandoffSituations, contactLink: "", onboarding: property.onboarding };
    await client.query("INSERT INTO property_settings(property_id,settings) VALUES($1,$2::jsonb)", [property.propertyId, JSON.stringify(settings)]);
    for (let i = 0; i < property.faqs.length; i += 1) {
      const faq = property.faqs[i];
      await client.query("INSERT INTO knowledge_items(property_id,knowledge_id,question,answer,knowledge_key,position) VALUES($1,$2,$3,$4,$5,$6)", [property.propertyId, `faq_${i + 1}`, faq.question, faq.answer, faq.knowledgeKey || null, i]);
    }
    for (const day of availability.days) {
      const values = [property.propertyId, day.date, ...["301","302","401","402"].map((id) => STATUS_MAP[day[id]])];
      const whole = values.slice(2).every((value) => value === "available") ? "available" : "closed";
      await client.query("INSERT INTO availability_days(property_id,stay_date,room301,room302,room401,room402,whole_house) VALUES($1,$2,$3,$4,$5,$6,$7)", [...values, whole]);
    }
    await ensureNephiBundle(client, property.propertyId);
    await client.query("COMMIT");
    return { seeded: true, propertyId: property.propertyId, roomTypeCount: property.rooms.length, knowledgeItemCount: property.faqs.length, availabilityDayCount: availability.days.length };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { await client.close(); }
}
async function materializeCanonicalKnowledgeKeys(client, property) {
  for (const faq of property.faqs || []) {
    if (!faq.knowledgeKey) continue;
    await client.query(
      "UPDATE knowledge_items SET knowledge_key=$3 WHERE property_id=$1 AND question=$2 AND COALESCE(knowledge_key,'')=''",
      [property.propertyId, faq.question, faq.knowledgeKey]
    );
  }
}
async function ensureNephiBundle(client, propertyId) {
  if(propertyId!=="nephi_home")return;
  const id="bundle_four_room_whole_house";
  await client.query("INSERT INTO bundle_offers(property_id,bundle_id,name,capacity,base_price,enabled) VALUES($1,$2,$3,$4,$5,true) ON CONFLICT DO NOTHING",[propertyId,id,"四房包棟",10,0]);
  for(const [index,roomId] of ["room301","room302","room401","room402"].entries())await client.query("INSERT INTO bundle_offer_members(property_id,bundle_id,room_id,position) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[propertyId,id,roomId,index]);
}
module.exports = { seedPostgres, materializeCanonicalKnowledgeKeys };
