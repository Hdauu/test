import "dotenv/config";
import fs from "fs";
import os from "os";
import { exec } from "child_process";
import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";

const { DISCORD_TOKEN, CHANNEL_ID, PROCESS_NAME, CHECK_INTERVAL } = process.env;
const STATE_FILE = "./state.json";

// Umbrales configurables
const CPU_LIMIT = 5;
const RAM_LIMIT = 85;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

/* ================= UTILIDADES ================= */

function getSystemStats() {
    const cpus = os.cpus();
    let idle = 0, total = 0;
    cpus.forEach(cpu => {
        for (let type in cpu.times) total += cpu.times[type];
        idle += cpu.times.idle;
    });
    return {
        cpuUsage: Math.round(100 - (idle / total) * 100),
        ramUsage: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)
    };
}

/**
 * Busca el proceso. Si no hay PROCESS_NAME, monitorea la máquina globalmente.
 */
function isServerRunning(name) {
    return new Promise((resolve) => {
        if (!name) return resolve(true); 
        const cmd = os.platform() === 'win32' ? `tasklist` : `ps ax`;
        exec(cmd, (err, stdout) => {
            if (err) return resolve(false);
            resolve(stdout.toLowerCase().includes(name.toLowerCase()));
        });
    });
}

/* ================= LÓGICA PRINCIPAL ================= */

async function updateStatus(isShuttingDown = false) {
    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) return;

        const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE)) : { messageId: null, lastStatus: null };
        const serverAlive = isShuttingDown ? false : await isServerRunning(PROCESS_NAME);
        const { cpuUsage, ramUsage } = getSystemStats();

        // Determinar Estado y Color
        let statusText = "🟢 FUNCIONANDO";
        let color = 0x2ECC71; // Esmeralda
        let currentStatus = "OK";

        if (isShuttingDown || !serverAlive) {
            statusText = "🔴 SERVIDOR APAGADO / CAÍDO";
            color = 0xE74C3C; // Alizarina (Rojo)
            currentStatus = "DOWN";
        } else if (cpuUsage > CPU_LIMIT || ramUsage > RAM_LIMIT) {
            statusText = "🟡 CARGA CRÍTICA";
            color = 0xF1C40F; // Girasol (Amarillo)
            currentStatus = "WARN";
        }

        const embed = new EmbedBuilder()
            .setTitle("📊 Monitor de Infraestructura")
            .setColor(color)
            .setThumbnail(client.user.displayAvatarURL())
            .addFields(
                { name: "Estado del Servicio", value: `**${statusText}**`, inline: false },
                { name: "🖥️ CPU", value: `${cpuUsage}%`, inline: true },
                { name: "💾 RAM", value: `${ramUsage}%`, inline: true },
                { name: "⏱️ Última Sincronización", value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
            )
            .setFooter({ text: `Vigilando proceso: ${PROCESS_NAME || "Sistema Completo"}` });

        let msg;
        if (state.messageId) {
            try {
                msg = await channel.messages.fetch(state.messageId);
                await msg.edit({ embeds: [embed] });
            } catch {
                msg = await channel.send({ embeds: [embed] });
            }
        } else {
            msg = await channel.send({ embeds: [embed] });
        }

        // Guardar ID y Estado
        state.messageId = msg.id;
        state.lastStatus = currentStatus;
        fs.writeFileSync(STATE_FILE, JSON.stringify(state));

        // Alerta por cambio de estado a DOWN (Solo si el bot sigue vivo)
        if (currentStatus === "DOWN" && !isShuttingDown) {
            const alert = await channel.send(`🚨 **ATENCIÓN:** Se ha detectado una caída en \`${PROCESS_NAME}\`. @everyone`);
            setTimeout(() => alert.delete().catch(() => {}), 30000);
        }

    } catch (error) {
        console.error("Error en el ciclo de monitoreo:", error);
    }
}

/* ================= GESTIÓN DE SALIDA ================= */

// Esto intenta marcar el bot como DOWN si cierras el proceso (Ctrl+C o Kill)
const shutdown = async () => {
    console.log("\n🛑 Recibida señal de apagado. Actualizando estado final...");
    await updateStatus(true);
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

/* ================= INICIO ================= */

client.once("clientReady", async () => {
    console.log(`✅ Bot conectado como ${client.user.tag}`);
    
    // Ejecución inicial e intervalo
    updateStatus();
    setInterval(() => updateStatus(), Number(CHECK_INTERVAL) || 30000);
});

client.login(DISCORD_TOKEN);