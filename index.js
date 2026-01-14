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

/* ================= ESTADO Y RECURSOS ================= */

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
  const cpus = os.cpus();
  let idle = 0, total = 0;
  cpus.forEach(cpu => {
    for (let type in cpu.times) total += cpu.times[type];
    idle += cpu.times.idle;
  });
  const cpuUsage = Math.round(100 - (idle / total) * 100);
  const ramUsage = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);
  
  return { cpuUsage, ramUsage, uptime: Math.round(os.uptime() / 3600) };
}

/* ================= BOT DE DISCORD ================= */

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function updateStatus(channel) {
  const stats = getSystemStats();
  const state = loadState();

  // Si esta función se ejecuta, el servidor se considera ONLINE
  const embed = new EmbedBuilder()
    .setTitle("🟢 Servidor: Funcionando")
    .setColor(0x00FF00)
    .setDescription("El sistema de monitoreo local está activo.")
    .addFields(
      { name: "CPU", value: `${stats.cpuUsage}%`, inline: true },
      { name: "RAM", value: `${stats.ramUsage}%`, inline: true },
      { name: "Uptime", value: `${stats.uptime} Horas`, inline: true }
    )
    .setTimestamp()
    .setFooter({ text: "Actualización automática" });

  try {
    let messageId = state.messageId;
    let msg;

    if (messageId) {
      try {
        msg = await channel.messages.fetch(messageId);
        await msg.edit({ embeds: [embed] });
      } catch {
        msg = await channel.send({ embeds: [embed] });
        messageId = msg.id;
      }
    } else {
      msg = await channel.send({ embeds: [embed] });
      messageId = msg.id;
    }

    saveState({ messageId });
  } catch (error) {
    console.error("Error al actualizar el canal:", error.message);
  }
}

/* ================= INICIO ================= */

// Usamos clientReady para evitar el Warning de la consola
client.once("clientReady", async () => {
  console.log(`✅ Monitoreo global iniciado como: ${client.user.tag}`);
  
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    
    // Ejecutar el primer chequeo
    await updateStatus(channel);

    // Intervalo de actualización
    setInterval(() => {
      updateStatus(channel).catch(console.error);
    }, Number(CHECK_INTERVAL) || 30000);

  } catch (err) {
    console.error("Error al acceder al canal de Discord:", err.message);
  }
});

client.login(DISCORD_TOKEN);