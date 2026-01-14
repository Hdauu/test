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
  const uptimeHours = Math.floor(os.uptime() / 3600);
  const uptimeMins = Math.floor((os.uptime() % 3600) / 60);

  return { cpuUsage, ramUsage, uptime: `${uptimeHours}h ${uptimeMins}m` };
}

/* ================= BOT DE DISCORD ================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

async function updateStatus(channel) {
  const stats = getSystemStats();
  const state = loadState();

  // Al no depender de checkPort, el bot siempre reportará ONLINE si el proceso corre
  const embed = new EmbedBuilder()
    .setTitle("🟢 Servidor: Funcionando Correctamente")
    .setColor(0x00FF00) // Verde
    .setDescription("El sistema de monitoreo local está activo y reportando recursos.")
    .addFields(
      { name: "Estado", value: "En Línea", inline: true },
      { name: "Uptime Máquina", value: stats.uptime, inline: true },
      { name: "\u200B", value: "\u200B", inline: true }, // Espaciador
      { name: "Uso de CPU", value: `${stats.cpuUsage}%`, inline: true },
      { name: "Uso de RAM", value: `${stats.ramUsage}%`, inline: true }
    )
    .setTimestamp()
    .setFooter({ text: "Actualización automática del sistema" });

  try {
    let messageId = state.messageId;

    if (messageId) {
      try {
        const msg = await channel.messages.fetch(messageId);
        await msg.edit({ embeds: [embed] });
      } catch (e) {
        // Si el mensaje fue borrado, enviamos uno nuevo
        const msg = await channel.send({ embeds: [embed] });
        messageId = msg.id;
      }
    } else {
      const msg = await channel.send({ embeds: [embed] });
      messageId = msg.id;
    }

    saveState({ messageId });
    console.log(`[${new Date().toLocaleTimeString()}] Panel actualizado en Discord.`);
  } catch (error) {
    console.error("Error al intentar actualizar Discord:", error.message);
  }
}

/* ================= START ================= */

// Cambiado a clientReady para eliminar el DeprecationWarning
client.once("clientReady", async () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    
    // Primer chequeo inmediato
    await updateStatus(channel);

    // Intervalo de actualización (por defecto 30 segundos)
    setInterval(() => {
      updateStatus(channel).catch(console.error);
    }, Number(CHECK_INTERVAL) || 30000);

  } catch (error) {
    console.error("Error crítico: No se pudo encontrar el canal.", error.message);
  }
});

client.login(DISCORD_TOKEN);