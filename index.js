import "dotenv/config";
import fs from "fs";
import os from "os";
import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";

/* ================= CONFIGURACIÓN ================= */
const {
  DISCORD_TOKEN,
  CHANNEL_ID,
  CHECK_INTERVAL,
} = process.env;

const STATE_FILE = "./state.json";

/* ================= FUNCIONES DE APOYO ================= */

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { messageId: null };
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { messageId: null };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getSystemStats() {
  // Cálculo de uso de CPU
  const cpus = os.cpus();
  let idle = 0, total = 0;
  cpus.forEach(cpu => {
    for (let type in cpu.times) total += cpu.times[type];
    idle += cpu.times.idle;
  });
  const cpuUsage = Math.round(100 - (idle / total) * 100);

  // Cálculo de uso de RAM
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const ramUsage = Math.round(((totalMem - freeMem) / totalMem) * 100);

  return {
    cpuUsage,
    ramUsage,
    uptime: Math.round(os.uptime() / 3600), // Uptime en horas
    platform: os.platform()
  };
}

/* ================= BOT DE DISCORD ================= */

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function updateStatus(channel) {
  const stats = getSystemStats();
  const state = loadState();

  // Si el bot llega a este punto, es porque el servidor está "UP"
  const embed = new EmbedBuilder()
    .setTitle("🟢 Servidor: En Línea")
    .setColor(0x00FF00)
    .setDescription("El bot de monitoreo se está ejecutando correctamente en el servidor local.")
    .addFields(
      { name: "Carga de CPU", value: `${stats.cpuUsage}%`, inline: true },
      { name: "Uso de RAM", value: `${stats.ramUsage}%`, inline: true },
      { name: "Sistema Uptime", value: `${stats.uptime} horas`, inline: true },
      { name: "SO", value: stats.platform.toUpperCase(), inline: true }
    )
    .setTimestamp()
    .setFooter({ text: "Actualización automática cada 30s" });

  try {
    let messageId = state.messageId;
    
    if (messageId) {
      try {
        const msg = await channel.messages.fetch(messageId);
        await msg.edit({ embeds: [embed] });
      } catch {
        // Si el mensaje fue borrado, enviamos uno nuevo
        const msg = await channel.send({ embeds: [embed] });
        messageId = msg.id;
      }
    } else {
      const msg = await channel.send({ embeds: [embed] });
      messageId = msg.id;
    }

    saveState({ messageId });
  } catch (error) {
    console.error("Error al actualizar Discord:", error.message);
  }
}

/* ================= INICIO ================= */

client.once("ready", async () => {
  console.log(`✅ Monitoreo global iniciado como: ${client.user.tag}`);
  
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    
    // Primer reporte
    updateStatus(channel);

    // Bucle infinito
    setInterval(() => {
      updateStatus(channel);
    }, Number(CHECK_INTERVAL) || 30000);

  } catch (err) {
    console.error("No se pudo acceder al canal de Discord:", err.message);
  }
});

client.login(DISCORD_TOKEN);