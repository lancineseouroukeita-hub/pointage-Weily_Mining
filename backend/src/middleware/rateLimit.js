// Limiteur simple par IP, en mémoire — les routes de pointage (voir
// pointage.routes.js) n'ont AUCUNE authentification (juste un matricule,
// choix de Lancine), donc rien n'empêcherait autrement un script d'essayer
// des matricules en boucle. Suffisant pour une seule instance de serveur
// (pas de Redis) : si l'app tourne un jour sur plusieurs instances, il
// faudrait déplacer ce compteur dans un stockage partagé.
function rateLimit({ windowMs, max }) {
  const hits = new Map(); // ip -> [timestamps]
  return (req, res, next) => {
    const ip = req.ip || 'inconnu';
    const now = Date.now();
    const windowStart = now - windowMs;
    const timestamps = (hits.get(ip) || []).filter((t) => t > windowStart);
    if (timestamps.length >= max) {
      return res.status(429).json({ error: 'Trop de tentatives, réessayez dans une minute.' });
    }
    timestamps.push(now);
    hits.set(ip, timestamps);
    next();
  };
}

module.exports = { rateLimit };
