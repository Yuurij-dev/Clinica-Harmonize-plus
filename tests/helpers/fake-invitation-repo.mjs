// Repo falso em memoria. transaction() tira snapshot e restaura se a funcao lancar (rollback).
export function makeRepo() {
  const db = { invitations: [], users: [], memberships: [], identities: [], staff: [{ userId: "admin", clinicId: "c1" }, { userId: "admin", clinicId: "c2" }], clinics: { c1: "Clinica Um", c2: "Clinica Dois" }, seq: 0 };
  const dupPending = (email, clinicId, exceptId) =>
    db.invitations.some((i) => i.status === "PENDING" && i.email === email && i.clinicId === clinicId && i.id !== exceptId);
  const p2002 = () => Object.assign(new Error("unique"), { code: "P2002" });
  const tx = {
    async lockClinicInvites() {},
    async countSentSince({ clinicId, since }) {
      return db.invitations.filter((i) => i.clinicId === clinicId && i.lastSentAt >= since).length;
    },
    async expireStalePending({ clinicId, email, now }) {
      for (const i of db.invitations) if (i.clinicId === clinicId && i.email === email && i.status === "PENDING" && i.expiresAt <= now) i.status = "EXPIRED";
    },
    async isMemberByEmail({ clinicId, email }) {
      return db.memberships.some((m) => m.clinicId === clinicId && db.users.find((u) => u.id === m.userId)?.email === email);
    },
    async countPending({ clinicId, now }) {
      return db.invitations.filter((i) => i.clinicId === clinicId && i.status === "PENDING" && i.expiresAt > now).length;
    },
    async create({ clinicId, email, role, tokenHash, expiresAt, invitedById, now }) {
      if (dupPending(email, clinicId)) throw p2002();
      const row = { id: `i${++db.seq}`, clinicId, email, role, tokenHash, status: "PENDING", expiresAt, invitedById, acceptedById: null, acceptedAt: null, lastSentAt: now, sendCount: 1, createdAt: now };
      db.invitations.push(row);
      return { ...row };
    },
    async findInClinic({ id, clinicId }) {
      const r = db.invitations.find((i) => i.id === id && i.clinicId === clinicId);
      return r ? { ...r } : null;
    },
    async rotate({ id, clinicId, tokenHash, expiresAt, now, maxSends, sentBefore }) {
      const r = db.invitations.find((i) => i.id === id && i.clinicId === clinicId);
      if (!r || !["PENDING", "EXPIRED"].includes(r.status) || r.sendCount >= maxSends || !(r.lastSentAt < sentBefore)) return 0;
      if (dupPending(r.email, r.clinicId, r.id)) throw p2002();
      Object.assign(r, { status: "PENDING", tokenHash, expiresAt, lastSentAt: now, sendCount: r.sendCount + 1 });
      return 1;
    },
    async cancelPending({ id, clinicId }) {
      const r = db.invitations.find((i) => i.id === id && i.clinicId === clinicId && i.status === "PENDING");
      if (!r) return 0;
      r.status = "CANCELLED";
      return 1;
    },
    async findByTokenHash(h) {
      const r = db.invitations.find((i) => i.tokenHash === h);
      return r ? { ...r, clinicName: db.clinics[r.clinicId] } : null;
    },
    async markAccepted({ id, clinicId, tokenHash, userId, now }) {
      const r = db.invitations.find((i) => i.id === id && i.clinicId === clinicId && i.tokenHash === tokenHash && i.status === "PENDING" && i.expiresAt > now);
      if (!r) return 0;
      Object.assign(r, { status: "ACCEPTED", acceptedById: userId, acceptedAt: now });
      return 1;
    },
    async findMembership({ userId, clinicId }) {
      return db.memberships.find((m) => m.userId === userId && m.clinicId === clinicId) ?? null;
    },
    async isMemberById({ userId, clinicId }) {
      return db.memberships.some((m) => m.userId === userId && m.clinicId === clinicId) || db.staff.some((m) => m.userId === userId && m.clinicId === clinicId);
    },
    async countMembershipsOutside({ userId, clinicId }) {
      return db.memberships.filter((m) => m.userId === userId && m.clinicId !== clinicId).length;
    },
    async createMembership({ userId, clinicId, role }) {
      db.memberships.push({ id: `m${++db.seq}`, userId, clinicId, role, isOwner: false });
    },
    async findUserByEmail(email) {
      return db.users.find((u) => u.email === email) ?? null;
    },
    async createIdentity({ userId, provider, sub, email }) {
      // @@unique([provider, providerSubject]) e @@unique([userId, provider])
      if (db.identities.some((i) => (i.provider === provider && i.sub === sub) || (i.userId === userId && i.provider === provider))) throw p2002();
      db.identities.push({ userId, provider, sub, email });
    },
    async createUser({ name, email, passwordHash, cpf, postalCode, address, country, state, city }) {
      if (db.users.some((u) => u.email === email)) throw p2002();
      const id = `u${++db.seq}`;
      db.users.push({ id, name, email, passwordHash, cpf, postalCode, address, country, state, city });
      return id;
    },
  };
  const repo = {
    ...tx,
    async transaction(fn) {
      const snap = structuredClone({ invitations: db.invitations, users: db.users, memberships: db.memberships, identities: db.identities });
      try {
        return await fn(tx);
      } catch (e) {
        Object.assign(db, structuredClone(snap));
        throw e;
      }
    },
    async list(clinicId) {
      return db.invitations.filter((i) => i.clinicId === clinicId).map((row) => { const rest = { ...row }; delete rest.tokenHash; return { ...rest, invitedByName: "Admin" }; });
    },
  };
  return { repo, db };
}
