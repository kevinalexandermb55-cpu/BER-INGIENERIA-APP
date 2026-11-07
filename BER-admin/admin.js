const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: "b-e-r-ingenieria"
});

async function configurarUsuarios() {
  try {
    let pagina;
    let total = 0;

    do {
      const resultado = await admin.auth().listUsers(1000, pagina);
      pagina = resultado.pageToken;

      for (const usuario of resultado.users) {
        const claims = usuario.customClaims || {};

        await admin.auth().setCustomUserClaims(usuario.uid, {
          ...claims,
          role: "authenticated"
        });

        console.log("Usuario configurado:", usuario.uid);
        total++;
      }
    } while (pagina);

    console.log("Total de usuarios configurados:", total);
  } catch (error) {
    console.error("Error:", error.message);
    process.exitCode = 1;
  }
}

configurarUsuarios();