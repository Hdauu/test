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

/* ================= GESTIÓN DE ESTADO ================= */
function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { messageId: null };
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch (err) {
    return { messageId: null };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/* ================= RECURSOS DEL SISTEMA ================= */
function getSystemStats() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  cpus.forEach(cpu => {
    for (let type in cpu.times) total += cpu.times[type];
    idle += cpu.times.idle;
  });
  const cpuUsage = Math.round(100 - (idle / total) * 100);
  const ramUsage = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);
  
  const uptimeH = Math.floor(os.uptime() / 3600);
  const uptimeM = Math.floor((os.uptime() % 3600) / 60);

  return { cpuUsage, ramUsage, uptime: `${uptimeH}h ${uptimeM}m` };
}

/* ================= BOT DE DISCORD ================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

async function updateStatus(channel) {
  const stats = getSystemStats();
  const state = loadState();

  // ELIMINADA TODA LÓGICA DE PUERTOS. 
  // Si el bot llega aquí, el estado es ONLINE por defecto.
  const embed = new EmbedBuilder()
    .setTitle("🟢 Servidor: Funcionando")
    .setColor(0x00FF00)
    .setDescription("El sistema de monitoreo está reportando actividad directamente desde el servidor local.")
    .addFields(
      { name: "Estado", value: "✅ En Línea", inline: true },
      { name: "Uptime", value: stats.uptime, inline: true },
      { name: "\u200B", value: "\u200B", inline: true },
      { name: "Carga CPU", value: `${stats.cpuUsage}%`, inline: true },
      { name: "Uso de RAM", value: `${stats.ramUsage}%`, inline: true }
    )
    .setTimestamp()
    .setFooter({ text: "Actualización en tiempo real" });

  try {
    let messageId = state.messageId;

    if (messageId) {
      try {
        const msg = await channel.messages.fetch(messageId);
        await msg.edit({ embeds: [embed] });
      } catch (e) {
        const msg = await channel.send({ embeds: [embed] });
        messageId = msg.id;
      }
    } else {
      const msg = await channel.send({ embeds: [embed] });
      messageId = msg.id;
    }

    saveState({ messageId });
    console.log(`[${new Date().toLocaleTimeString()}] Panel actualizado correctamente.`);
  } catch (error) {
    console.error("Error al actualizar Discord:", error.message);
  }
}

/* ================= INICIO ================= */

// Cambiado a 'clientReady' para eliminar el DeprecationWarning de tu consola
client.once("clientReady", async () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    
    // Ejecución inicial
    await updateStatus(channel);

    // Bucle de actualización (30 segundos por defecto)
    setInterval(() => {
      updateStatus(channel).catch(console.error);
    }, Number(CHECK_INTERVAL) || 30000);

  } catch (error) {
    console.error("Error crítico: No se pudo conectar al canal.", error.message);
  }
});

client.login(DISCORD_TOKEN);