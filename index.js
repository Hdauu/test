import "dotenv/config";
import fs from "fs";
import os from "os";
import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";

/* ================= CONFIGURACIÓN ================= */
const {
  DISCORD_TOKEN,
  CHANNEL_ID,
  LOG_FILE_PATH, // Ruta al archivo que el servidor actualiza (ej: "server.log")
  CHECK_INTERVAL,
} = process.env;

const STATE_FILE = "./state.json";

/* ================= LÓGICA DE MONITOREO ================= */

function checkServerByLog(path) {
  try {
    if (!fs.existsSync(path)) return false;

    const stats = fs.statSync(path);
    const now = new Date().getTime();
    const lastUpdate = stats.mtime.getTime();
    
    // Si el archivo se actualizó hace menos de 2 minutos, el servidor está vivo
    const diffSeconds = (now - lastUpdate) / 1000;
    return diffSeconds < 120; 
  } catch (err) {
    return false;
  }
}

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

/* ================= BOT DE DISCORD ================= */

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function updateStatus(channel) {
  const isOnline = checkServerByLog(LOG_FILE_PATH);
  const { cpuUsage, ramUsage } = getSystemStats();
  const state = JSON.parse(fs.existsSync(STATE_FILE) ? fs.readFileSync(STATE_FILE) : '{"messageId":null}');

  const embed = new EmbedBuilder()
    .setTitle(isOnline ? "🟢 Servidor Activo" : "🔴 Servidor Caído")
    .setColor(isOnline ? 0x00FF00 : 0xFF0000)
    .addFields(
      { name: "Última actividad", value: isOnline ? "Reciente" : "Hace más de 2 min", inline: true },
      { name: "Carga CPU", value: `${cpuUsage}%`, inline: true },
      { name: "Uso RAM", value: `${ramUsage}%`, inline: true }
    )
    .setTimestamp();

  try {
    let msg;
    if (state.messageId) {
      msg = await channel.messages.fetch(state.messageId);
      await msg.edit({ embeds: [embed] });
    } else {
      msg = await channel.send({ embeds: [embed] });
      state.messageId = msg.id;
      fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    }
  } catch {
    const msg = await channel.send({ embeds: [embed] });
    state.messageId = msg.id;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  }
}

/* ================= START ================= */

client.once("ready", async () => {
  console.log(`🤖 Bot listo. Monitoreando archivo: ${LOG_FILE_PATH}`);
  const channel = await client.channels.fetch(CHANNEL_ID);
  
  setInterval(() => updateStatus(channel), Number(CHECK_INTERVAL) || 30000);
});

client.login(DISCORD_TOKEN);