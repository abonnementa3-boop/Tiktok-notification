require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { WebcastPushConnection } = require('tiktok-live-connector');

// ── Configuration ──────────────────────────────────────────────
const DISCORD_TOKEN   = process.env.DISCORD_TOKEN;
const CHANNEL_ID      = process.env.CHANNEL_ID_LIVE;
const ACCOUNTS        = process.env.TIKTOK_ACCOUNTS.split(',').map(a => a.trim());
const CHECK_INTERVAL  = parseInt(process.env.CHECK_INTERVAL || '60') * 1000;

// ── État interne ───────────────────────────────────────────────
const liveStatus      = {};   // true/false par compte
const connections     = {};   // WebcastPushConnection par compte

// ── Client Discord ─────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
    console.log(`✅ Bot connecté : ${client.user.tag}`);
    console.log(`📋 Comptes surveillés : ${ACCOUNTS.join(', ')}`);
    // Lancer la surveillance pour chaque compte
    ACCOUNTS.forEach(username => {
        liveStatus[username]  = false;
        connections[username] = null;
    });
    checkAllAccounts();
    setInterval(checkAllAccounts, CHECK_INTERVAL);
});

// ── Envoi notification Discord ─────────────────────────────────
async function sendNotification(username, type) {
    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel) {
        console.error(`❌ Salon introuvable (ID: ${CHANNEL_ID})`);
        return;
    }

    if (type === 'live') {
        const embed = new EmbedBuilder()
            .setColor(0xFF0050)
            .setTitle('🔴  LIVE EN COURS !')
            .setDescription(`**@${username}** est maintenant en live sur TikTok !`)
            .addFields({
                name: '🔗 Rejoindre le live',
                value: `[Clique ici](https://www.tiktok.com/@${username}/live)`,
            })
            .setThumbnail('https://sf16-website-login.neutral.ttwstatic.com/obj/tiktok_web_login_static/tiktok/webapp/main/webapp-desktop/8152caf0c8e8bc67ae0d.png')
            .setTimestamp()
            .setFooter({ text: 'TikTok Live Notifier' });

        await channel.send({ content: '@everyone', embeds: [embed] });
        console.log(`🔴 [${username}] Live démarré → notification envoyée`);

    } else if (type === 'end') {
        const embed = new EmbedBuilder()
            .setColor(0x808080)
            .setTitle('⭕  Live terminé')
            .setDescription(`**@${username}** a terminé son live. Merci d'avoir regardé !`)
            .setTimestamp()
            .setFooter({ text: 'TikTok Live Notifier' });

        await channel.send({ embeds: [embed] });
        console.log(`⭕ [${username}] Live terminé → notification envoyée`);
    }
}

// ── Connexion à un live TikTok ─────────────────────────────────
async function connectToLive(username) {
    // Éviter les doubles connexions
    if (connections[username]) return;

    const tiktok = new WebcastPushConnection(username, {
        fetchRoomInfoOnConnect: true,
        enableExtendedGiftInfo: false,
    });

    try {
        await tiktok.connect();

        // Le compte est en live
        if (!liveStatus[username]) {
            liveStatus[username] = true;
            connections[username] = tiktok;
            await sendNotification(username, 'live');
        }

        // Fin du live
        tiktok.on('streamEnd', async () => {
            console.log(`📴 [${username}] Événement streamEnd reçu`);
            liveStatus[username]  = false;
            connections[username] = null;
            await sendNotification(username, 'end');
        });

        // Déconnexion inattendue → on nettoie pour re-vérifier au prochain cycle
        tiktok.on('disconnected', () => {
            console.log(`⚠️  [${username}] Déconnecté du live`);
            if (liveStatus[username]) {
                liveStatus[username]  = false;
                connections[username] = null;
                // On ne notifie pas ici : streamEnd le fait déjà
            }
        });

    } catch {
        // Pas en live ou erreur de connexion → on ignore silencieusement
        connections[username] = null;
        if (liveStatus[username]) {
            // Était en live et plus accessible → on considère terminé
            liveStatus[username] = false;
            await sendNotification(username, 'end');
        }
    }
}

// ── Boucle de surveillance ─────────────────────────────────────
async function checkAllAccounts() {
    for (const username of ACCOUNTS) {
        // Ne pas re-connecter si déjà connecté
        if (!connections[username]) {
            await connectToLive(username);
        }
    }
}

// ── Démarrage ─────────────────────────────────────────────────
client.login(DISCORD_TOKEN).catch(err => {
    console.error('❌ Impossible de se connecter à Discord :', err.message);
    process.exit(1);
});
