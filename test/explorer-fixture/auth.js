// Auth-Modul des Fixture-Projekts
function login(username, password) {
  // einfache Demo-Prüfung
  if (!username || !password) return { ok: false, error: 'Zugangsdaten fehlen' };
  return { ok: true, user: username };
}
module.exports = { login };
