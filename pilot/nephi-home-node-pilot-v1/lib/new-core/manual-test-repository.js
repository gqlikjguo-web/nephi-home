"use strict";

const crypto = require("node:crypto");

function copy(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

class NewCoreManualTestRepository {
  constructor({ persistence = null, now = () => new Date() } = {}) {
    this.persistence = persistence;
    this.now = now;
    this.sessions = new Map();
    this.turns = new Map();
  }

  async createSession({ testSessionId = crypto.randomUUID(), ownerId, propertyId, state }) {
    const row = { testSessionId, ownerId, propertyId, generation: 1, state: copy(state), createdAt: this.now().toISOString(), updatedAt: this.now().toISOString() };
    if (this.persistence && typeof this.persistence.createNewCoreTestSession === "function") return this.persistence.createNewCoreTestSession(row);
    this.sessions.set(row.testSessionId, copy(row));
    return copy(row);
  }

  async getSession(testSessionId, ownerId, propertyId) {
    if (this.persistence && typeof this.persistence.getNewCoreTestSession === "function") return this.persistence.getNewCoreTestSession(testSessionId, ownerId, propertyId);
    const row = this.sessions.get(testSessionId);
    return row && row.ownerId === ownerId && row.propertyId === propertyId ? copy(row) : null;
  }

  async saveTurn({ session, state, turn }) {
    if (this.persistence && typeof this.persistence.saveNewCoreTestTurn === "function") return this.persistence.saveNewCoreTestTurn({ session, state, turn });
    const current = this.sessions.get(session.testSessionId);
    if (!current || current.ownerId !== session.ownerId || current.propertyId !== session.propertyId
      || current.generation !== session.generation || current.state.revision !== session.state.revision) {
      const error = new Error("new_core_test_session_conflict"); error.code = "TEST_SESSION_CONFLICT"; error.status = 409; throw error;
    }
    const updated = { ...session, state: copy(state), updatedAt: this.now().toISOString() };
    this.sessions.set(session.testSessionId, updated);
    this.turns.set(turn.turnId, copy(turn));
    return copy(turn);
  }

  async newConversation(session, state) {
    if (this.persistence && typeof this.persistence.resetNewCoreTestConversation === "function") return this.persistence.resetNewCoreTestConversation(session.testSessionId, session.ownerId, session.propertyId, state);
    const updated = { ...session, generation: session.generation + 1, state: copy(state), updatedAt: this.now().toISOString() };
    this.sessions.set(session.testSessionId, updated);
    return copy(updated);
  }

  async listTurns(testSessionId, ownerId, propertyId) {
    if (this.persistence && typeof this.persistence.listNewCoreTestTurns === "function") return this.persistence.listNewCoreTestTurns(testSessionId, ownerId, propertyId);
    return [...this.turns.values()].filter((row) => row.testSessionId === testSessionId && row.ownerId === ownerId && row.propertyId === propertyId).sort((a, b) => a.timestamp.localeCompare(b.timestamp)).map(copy);
  }

  async reviewTurn({ turnId, ownerId, propertyId, reviewStatus, problemCategory, note }) {
    if (this.persistence && typeof this.persistence.reviewNewCoreTestTurn === "function") return this.persistence.reviewNewCoreTestTurn(turnId, ownerId, propertyId, reviewStatus, problemCategory, note);
    const row = this.turns.get(turnId);
    if (!row || row.ownerId !== ownerId || row.propertyId !== propertyId) return null;
    const updated = { ...row, manualReview: { status: reviewStatus, problemCategory, note } };
    this.turns.set(turnId, updated);
    return copy(updated);
  }

  async listRecords(ownerId, propertyId, filter) {
    if (this.persistence && typeof this.persistence.listNewCoreTestRecords === "function") return this.persistence.listNewCoreTestRecords(ownerId, propertyId, filter);
    return [...this.turns.values()].filter((row) => row.ownerId === ownerId && row.propertyId === propertyId && (filter === "all" || filter === "problem" && row.manualReview.status === "PROBLEM" || filter === "unmarked" && row.manualReview.status === "UNMARKED")).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 100).map(copy);
  }

  async findByTraceId(traceId, ownerId, propertyId) {
    if (this.persistence && typeof this.persistence.getNewCoreTestRecordByTraceId === "function") return this.persistence.getNewCoreTestRecordByTraceId(traceId, ownerId, propertyId);
    const row = [...this.turns.values()].find((item) => item.traceId === traceId && item.ownerId === ownerId && item.propertyId === propertyId);
    return row ? copy(row) : null;
  }
}

module.exports = { NewCoreManualTestRepository };
