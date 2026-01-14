import "dotenv/config";
import fs from "fs";
import os from "os";
import { exec } from "child_process"; 
import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";

const { DISCORD_TOKEN, CHANNEL_ID, PROCESS_NAME, CHECK_INTERVAL } = process.env;
const STATE_FILE = "./state.json";

// Umbrales para pruebas
const CPU_LIMIT = 5;
const RAM_LIMIT = 85;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

/* ================= LÓGICA DE MONITOREO ================= */

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

// Busca si el proceso del servidor existe en el sistema
function isServerRunning(name) {
  return new Promise((resolve) => {
    if (!name) return resolve(true);
    const cmd = os.platform() === 'win32' ? `tasklist` : `ps aux`;
    exec(cmd, (err, stdout) => {
      resolve(stdout.toLowerCase().includes(name.toLowerCase()));
    });
  });
}

async function updateStatus(channel, forceStatus = null) {
  if (!channel) return;
  const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE)) : { messageId: null };
  
  const serverAlive = forceStatus ? false : await isServerRunning(PROCESS_NAME);
  const { cpuUsage, ramUsage } = getSystemStats();

  let statusText = "🟢 EN LÍNEA";
  let color = 0x00FF00;

  if (forceStatus === "SHUTDOWN" || !serverAlive) {
    statusText = "🔴 SERVIDOR CAÍDO / APAGADO";
    color = 0xFF0000;
  } else if (cpuUsage > CPU_LIMIT || ramUsage > RAM_LIMIT) {
    statusText = "🟡 CARGA ALTA";
    color = 0xFFFF00;
  }

  const embed = new EmbedBuilder()
    .setTitle("Monitor de Sistema")
    .setColor(color)
    .setDescription(`Estado actual: **${statusText}**`)
    .addFields(
      { name: "CPU", value: `${cpuUsage}%`, inline: true },
      { name: "RAM", value: `${ramUsage}%`, inline: true },
      { name: "Proceso", value: PROCESS_NAME || "Sistema Global", inline: true }
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
    
    // Alerta por caída detectada mientras el bot vive
    if (!serverAlive && forceStatus !== "SHUTDOWN") {
       const alert = await channel.send(`🚨 **¡Alerta!** El proceso \`${PROCESS_NAME}\` no responde. @everyone`);
       setTimeout(() => alert.delete().catch(() => {}), 10000);
    }
  } catch (e) {
    const msg = await channel.send({ embeds: [embed] });
    state.messageId = msg.id;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  }
}

/* ================= EVENTOS DE CIERRE ================= */

// Si cierras el bot, intentará poner el mensaje en rojo antes de salir
const handleShutdown = async () => {
  console.log("Cerrando bot... notificando a Discord.");
  const channel = await client.channels.fetch(CHANNEL_ID);
  await updateStatus(channel, "SHUTDOWN");
  process.exit();
};

process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);

/* ================= INICIO ================= */

client.once("clientReady", async () => {
  console.log(`✅ Monitor iniciado como ${client.user.tag}`);
  const channel = await client.channels.fetch(CHANNEL_ID);
  
  setInterval(() => updateStatus(channel), Number(CHECK_INTERVAL) || 30000);
  updateStatus(channel);
});

client.login(DISCORD_TOKEN);