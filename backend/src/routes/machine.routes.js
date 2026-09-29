const express = require('express');
const multer = require('multer');
const {
  importMachineLog, reapplyPunches, machineStatus, admsHandshake, admsReceive, admsIdle,
} = require('../controllers/machine.controller');
const { requireAdmin } = require('../middleware/adminAuth');
const { asyncHandler } = require('../utils/asyncHandler');

// Espace admin : import de fichier, recalcul, état des machines.
const adminRouter = express.Router();
// 20 Mo : un mois de pointages pour ~500 employés tient en quelques Mo.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
adminRouter.post('/import', requireAdmin, upload.single('file'), asyncHandler(importMachineLog));
adminRouter.post('/reapply', requireAdmin, asyncHandler(reapplyPunches));
adminRouter.get('/status', requireAdmin, asyncHandler(machineStatus));

// Adresses appelées DIRECTEMENT par la pointeuse (protocole ADMS/iClock) :
// pas de compte admin possible côté machine, la sécurité repose sur la
// liste MACHINE_SERIALS (voir machine.controller.js, checkSerial). Corps
// des requêtes en texte brut, pas en JSON.
const iclockRouter = express.Router();
iclockRouter.use(express.text({ type: '*/*', limit: '5mb' }));
iclockRouter.get('/cdata', asyncHandler(admsHandshake));
iclockRouter.post('/cdata', asyncHandler(admsReceive));
iclockRouter.get('/getrequest', asyncHandler(admsIdle));
iclockRouter.post('/devicecmd', asyncHandler(admsIdle));

module.exports = { adminRouter, iclockRouter };
