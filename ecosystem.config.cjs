// Configuration pm2 — démarrage et redémarrage auto de l'app.
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup   (pour relancer au boot du VPS)
// Les variables d'environnement sont lues depuis le fichier .env par src/config.js.
module.exports = {
  apps: [
    {
      name: 'rallye-latrace',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      env: { NODE_ENV: 'production' },
    },
  ],
};
