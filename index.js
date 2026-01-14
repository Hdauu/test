import "dotenv/config";
import fs from "fs";
import net from "net";
import os from "os";
import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";

/* ================= CONFIGURACIÓN ================= */
const {
  DISCORD_TOKEN,
  CHANNEL_ID,
  SERVER_PORT,
  CPU_WARN,
  RAM_WARN,
  CHECK_INTERVAL,
} = process.env;

const STATE_FILE = "./state.json";
const SERVER_HOST = "127.0.0.1"; // Al estar en la misma máquina, usamos localhost

/* ================= GESTIÓN DE ESTADO ================= */
function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { messageId: null, lastStatus: null };
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { messageId: null, lastStatus: null };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/* ================= LÓGICA DE MONITOREO ================= */

// Verifica si el puerto está abierto
function checkPort(port, timeout = 5000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);

    socket
      .once("connect", () => {
        socket.destroy();
        resolve(true);
      })
      .once("timeout", () => {
        socket.destroy();
        resolve(false);
      })
      .once("error", () => {
        socket.destroy();
        resolve(false);
      })
      .connect(Number(port), SERVER_HOST);
  });
}

// Obtiene estadísticas del sistema
function getSystemStats() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  cpus.forEach(cpu => {
    for (let type in cpu.times) total += cpu.times[type];
    idle += cpu.times.idle;
  });
  const cpuUsage = Math.round(100 - (idle / total) * 100);
  const ramUsage = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);
  return { cpuUsage, ramUsage };
}

/* ================= BOT DE DISCORD ================= */

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function updateStatus(channel) {
  const state = loadState();
  const isOnline = await checkPort(SERVER_PORT);
  const { cpuUsage, ramUsage } = getSystemStats();

  let status = "DOWN", color = 0xff0000, emoji = "🔴";
  
  if (isOnline) {
    if (cpuUsage >= Number(CPU_WARN) || ramUsage >= Number(RAM_WARN)) {
      status = "WARN";
      color = 0xffff00; // Amarillo
      emoji = "🟡";
    } else {
      status = "OK";
      color = 0x00ff00; // Verde
      emoji = "🟢";
    }
  }

  // Crear el Embed (la tarjeta visual)
  const embed = new EmbedBuilder()
    .setTitle(`${emoji} Estado del Servidor`)
    .setColor(color)
    .addFields(
      { name: "Estatus", value: status === "OK" ? "En línea" : status === "WARN" ? "Rendimiento Crítico" : "Desconectado", inline: true },
      { name: "CPU", value: `${cpuUsage}%`, inline: true },
      { name: "RAM", value: `${ramUsage}%`, inline: true }
    )
    .setTimestamp()
    .setFooter({ text: `Puerto monitoreado: ${SERVER_PORT}` });

  let messageId = state.messageId;

  try {
    if (messageId) {
      const msg = await channel.messages.fetch(messageId);
      await msg.edit({ content: null, embeds: [embed] });
    } else {
      const msg = await channel.send({ embeds: [embed] });
      messageId = msg.id;
    }
  } catch (err) {
    // Si el mensaje no existe o fue borrado, enviamos uno nuevo
    const msg = await channel.send({ embeds: [embed] });
    messageId = msg.id;
  }

  // Notificación extra (ping) solo si el estado cambió a algo malo
  if (status !== state.lastStatus && (status === "DOWN" || status === "WARN")) {
    const alert = await channel.send(`⚠️ **Atención:** El servidor ha cambiado a estado: **${status}** @everyone`);
    setTimeout(() => alert.delete().catch(() => {}), 15000); // Borrar alerta en 15s
  }

  saveState({ messageId, lastStatus: status });
  console.log(`[${new Date().toLocaleTimeString()}] Chequeo finalizado: ${status}`);
}

/* ================= INICIO ================= */

client.once("ready", async () => {
  console.log(`✅ Bot activo: ${client.user.tag}`);
  
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    
    // Ejecutar inmediatamente al prender
    await updateStatus(channel);

    // Ciclo de repetición
    setInterval(() => {
      updateStatus(channel).catch(console.error);
    }, Number(CHECK_INTERVAL) || 60000);

  } catch (error) {
    console.error("Error crítico al obtener el canal:", error.message);
  }
});

client.login(DISCORD_TOKEN);