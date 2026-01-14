import "dotenv/config";
import fs from "fs";
import os from "os";
import { exec } from "child_process";
import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";

const { 
    DISCORD_TOKEN, 
    CHANNEL_ID, 
    CPU_WARN = 80, 
    RAM_WARN = 85,
    CHECK_INTERVAL = 15000 
} = process.env;

const STATE_FILE = "./state.json";
const MAINTENANCE_FILE = "./maintenance.flag";

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
        ramUsage: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
        totalRam: (os.totalmem() / (1024 ** 3)).toFixed(1),
        freeRam: (os.freemem() / (1024 ** 3)).toFixed(1)
    };
}

/**
 * Verifica si el servidor Hytale está corriendo
 */
function isHytaleRunning() {
    return new Promise((resolve) => {
        // Busca procesos Java relacionados con Hytale
        const cmd = `ps aux | grep -i "java.*hytale" | grep -v grep`;
        exec(cmd, (err, stdout) => {
            resolve(stdout.trim().length > 0);
        });
    });
}

/**
 * Verifica si existe el archivo de mantenimiento
 */
function isInMaintenance() {
    return fs.existsSync(MAINTENANCE_FILE);
}

/* ================= LÓGICA PRINCIPAL ================= */

async function updateStatus(isShuttingDown = false) {
    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) return;

        const state = fs.existsSync(STATE_FILE) 
            ? JSON.parse(fs.readFileSync(STATE_FILE)) 
            : { messageId: null, lastStatus: null };

        const serverAlive = isShuttingDown ? false : await isHytaleRunning();
        const inMaintenance = isInMaintenance();
        const { cpuUsage, ramUsage, totalRam, freeRam } = getSystemStats();

        // Determinar Estado y Color
        let statusText = "";
        let statusEmoji = "";
        let color = 0x2ECC71;
        let currentStatus = "OK";
        let description = "";

        if (inMaintenance) {
            // 🔧 MANTENIMIENTO
            statusText = "MANTENIMIENTO PROGRAMADO";
            statusEmoji = "🔧";
            color = 0x3498DB; // Azul
            currentStatus = "MAINTENANCE";
            description = "El servidor está en modo mantenimiento. Volverá pronto.";
        } else if (isShuttingDown || !serverAlive) {
            // 🔴 CAÍDO
            statusText = "SERVIDOR CAÍDO";
            statusEmoji = "🔴";
            color = 0xE74C3C; // Rojo
            currentStatus = "DOWN";
            description = "El proceso de Hytale no está activo. Verifica los logs del servidor.";
        } else if (cpuUsage > Number(CPU_WARN) || ramUsage > Number(RAM_WARN)) {
            // 🟡 PROBLEMAS DE RENDIMIENTO
            statusText = "PROBLEMAS DE RENDIMIENTO";
            statusEmoji = "🟡";
            color = 0xF39C12; // Naranja
            currentStatus = "WARN";
            
            const issues = [];
            if (cpuUsage > Number(CPU_WARN)) issues.push(`CPU alta (${cpuUsage}%)`);
            if (ramUsage > Number(RAM_WARN)) issues.push(`RAM alta (${ramUsage}%)`);
            description = `⚠️ **Advertencias detectadas:**\n${issues.join('\n')}`;
        } else {
            // 🟢 FUNCIONANDO CORRECTAMENTE
            statusText = "FUNCIONANDO CORRECTAMENTE";
            statusEmoji = "🟢";
            color = 0x2ECC71; // Verde
            currentStatus = "OK";
            description = "Todos los sistemas operando dentro de parámetros normales.";
        }

        const embed = new EmbedBuilder()
            .setColor(color)
            .addFields(
                { 
                    name: "Estado", 
                    value: `${statusEmoji} **${statusText}**`, 
                    inline: false 
                },
                { 
                    name: "CPU", 
                    value: `${cpuUsage}%`, 
                    inline: true 
                },
                { 
                    name: "RAM", 
                    value: `${ramUsage}%`, 
                    inline: true 
                },
                { 
                    name: "Última actualización", 
                    value: `<t:${Math.floor(Date.now() / 1000)}:R>`, 
                    inline: false 
                }
            );

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
        const previousStatus = state.lastStatus;
        state.lastStatus = currentStatus;
        fs.writeFileSync(STATE_FILE, JSON.stringify(state));

        // Alertas por cambio de estado
        if (previousStatus && previousStatus !== currentStatus && !isShuttingDown) {
            let alertMessage = "";
            
            if (currentStatus === "DOWN") {
                alertMessage = `🚨 **ALERTA CRÍTICA:** El servidor Hytale se ha caído. <@&YOUR_ADMIN_ROLE_ID>`;
            } else if (currentStatus === "WARN" && previousStatus === "OK") {
                alertMessage = `⚠️ **Advertencia:** Detectados problemas de rendimiento en el servidor.`;
            } else if (currentStatus === "OK" && previousStatus !== "MAINTENANCE") {
                alertMessage = `✅ **Restaurado:** El servidor ha vuelto a la normalidad.`;
            } else if (currentStatus === "MAINTENANCE") {
                alertMessage = `🔧 **Información:** El servidor ha entrado en modo mantenimiento.`;
            }

            if (alertMessage) {
                const alert = await channel.send(alertMessage);
                setTimeout(() => alert.delete().catch(() => {}), 60000);
            }
        }

    } catch (error) {
        console.error("❌ Error en el ciclo de monitoreo:", error);
    }
}

/* ================= COMANDOS MANUALES ================= */

/**
 * Para activar mantenimiento: touch maintenance.flag
 * Para desactivar: rm maintenance.flag
 */

/* ================= GESTIÓN DE SALIDA ================= */

const shutdown = async () => {
    console.log("\n🛑 Recibida señal de apagado. Actualizando estado final...");
    await updateStatus(true);
    setTimeout(() => process.exit(0), 1000);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

/* ================= INICIO ================= */

client.once("ready", async () => {
    console.log(`✅ Bot conectado como ${client.user.tag}`);
    console.log(`📡 Monitoreando canal: ${CHANNEL_ID}`);
    console.log(`⚙️  CPU límite: ${CPU_WARN}% | RAM límite: ${RAM_WARN}%`);
    console.log(`🔄 Intervalo: ${Number(CHECK_INTERVAL) / 1000} segundos\n`);
    
    // Ejecución inicial e intervalo
    updateStatus();
    setInterval(() => updateStatus(), Number(CHECK_INTERVAL));
});

client.login(DISCORD_TOKEN);