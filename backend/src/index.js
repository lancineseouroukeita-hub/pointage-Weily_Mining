require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth.routes');
const employeeRoutes = require('./routes/employee.routes');
const pointageRoutes = require('./routes/pointage.routes');
const reportRoutes = require('./routes/report.routes');
const settingsRoutes = require('./routes/settings.routes');

const app = express();
// Nécessaire derrière le proxy inverse de Render pour que req.ip renvoie la
// vraie IP du client (sinon le rate limiting par IP — voir
// middleware/rateLimit.js — traiterait tout le monde comme une seule IP).
app.set('trust proxy', 1);

const corsOriginEnv = process.env.CORS_ORIGIN || '*';
const corsOrigin = corsOriginEnv === '*' ? '*' : corsOriginEnv.split(',');
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/pointage', pointageRoutes);
app.use('/api/report', reportRoutes);
app.use('/api/settings', settingsRoutes);

// Sert l'application web (écran de pointage + espace admin) — même principe
// que seourouApps : tout sur la même origine, pas de serveur séparé à lancer.
app.use(express.static(path.join(__dirname, '..', 'public')));

// Gestionnaire d'erreurs générique (dernier recours) : reçoit toutes les
// erreurs des contrôleurs via asyncHandler, en plus des erreurs internes à
// Express (ex: JSON mal formé, qui porte déjà un vrai statusCode 400).
app.use((err, req, res, next) => {
  console.error(err);
  // Erreur multer "fichier trop volumineux" (import Excel employés, image de
  // fond) : sans ce cas particulier, err.statusCode n'est pas défini et on
  // tomberait sur "Erreur serveur interne." — message peu clair pour un
  // dépassement de taille pourtant fréquent (photo prise avec un téléphone).
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Fichier trop volumineux.' });
  }
  const rawStatus = err.statusCode || err.status;
  const status = (typeof rawStatus === 'number' && rawStatus >= 400 && rawStatus < 500) ? rawStatus : 500;
  res.status(status).json({ error: status === 500 ? 'Erreur serveur interne.' : (err.message || 'Requête invalide.') });
});

const PORT = process.env.PORT || 4100;
app.listen(PORT, () => {
  console.log(`Serveur de pointage démarré sur le port ${PORT}`);
});
