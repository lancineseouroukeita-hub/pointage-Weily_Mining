// Évite un try/catch répété dans chaque contrôleur : toute erreur rejetée
// (y compris async) est transmise au gestionnaire d'erreurs central
// (voir index.js), qui répond systématiquement en JSON plutôt que de faire
// planter le serveur.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { asyncHandler };
