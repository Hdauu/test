import "dotenv/config";
import fs from "fs";
import net from "net";
import os from "os";
import { Client, GatewayIntentBits } from "discord.js";

/* ================= CONFIG ================= */

const {
  DISCORD_TOKEN,
  CHANNEL_ID,
  SERVER_HOST,
  SERVER_PORT,
  CPU_WARN,
  RAM_WARN,
  CHECK_INTERVAL,
} = process.env;

const STATE_FILE = "./state.json";

/* ================= STATE ================= */

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { messageId: null, lastStatus: null };
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch (err) {
    return { messageId: null, lastStatus: null };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/* ================= CHECKS ================= */

/**
 * Intenta abrir una conexión TCP al host y puerto especificados.
 * Se aumenta el timeout y se añade limpieza de socket.
 */
function checkPort(host, port, timeout = 5000) {
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
        console.log(`[LOG] Timeout intentando conectar a ${host}:${port}`);
        resolve(false);
      })
      .once("error", (err) => {
        socket.destroy();
        console.log(`[LOG] Error de conexión en ${host}:${port} -> ${err.message}`);
        resolve(false);
      })
      .connect(Number(port), host);
  });
}

function getCpuUsage() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) total += cpu.times[type];
    idle += cpu.times.idle;
  }

  return Math.round(100 - (idle / total) * 100);
}

function getRamUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  return Math.round(((total - free) / total) * 100);
}

/* ================= DISCORD ================= */

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

async function updateStatusMessage(channel, text, state) {
  if (state.messageId) {
    try {
      const msg = await channel.messages.fetch(state.messageId);
      await msg.edit(text);
      return state.messageId;
    } catch (e) {
      console.log("[LOG] No se pudo editar el mensaje anterior, enviando uno nuevo.");
    }
  }

  const msg = await channel.send(text);
  return msg.id;
}

async function sendPing(channel, text) {
  try {
    const msg = await channel.send({
      content: `@everyone ⚠️ **Alerta de Estado:** ${text}`,
      allowedMentions: { parse: ["everyone"] },
    });

    // Borrar el ping luego de 15s para no ensuciar el canal
    setTimeout(() => msg.delete().catch(() => {}), 15000);
  } catch (err) {
    console.error("[ERROR] No se pudo enviar el ping:", err.message);
  }
}

/* ================= STATUS LOGIC ================= */

async function checkStatus(channel) {
  const state = loadState();
  const online = await checkPort(SERVER_HOST, SERVER_PORT);

  let status;
  let text;

  if (!online) {
    status = "DOWN";
    text = "🔴 **Estado:** Actualmente Caído o Inalcanzable";
  } else {
    const cpu = getCpuUsage();
    const ram = getRamUsage();

    if (cpu >= Number(CPU_WARN) || ram >= Number(RAM_WARN)) {
      status = "WARN";
      text = `🟡 **Estado:** Problemas de rendimiento (CPU: ${cpu}% | RAM: ${ram}%)`;
    } else {
      status = "OK";
      text = `🟢 **Estado:** Funcionando correctamente (CPU: ${cpu}% | RAM: ${ram}%)`;
    }
  }

  console.log(`[CHECK] ${new Date().toLocaleTimeString()} | ${status}`);

  // Actualizar el mensaje principal
  const messageId = await updateStatusMessage(channel, text, state);

  // Enviar ping si el estado cambió a algo crítico (DOWN o WARN)
  if (status !== state.lastStatus) {
    if (status === "DOWN" || status === "WARN") {
      await sendPing(channel, text);
    }
  }

  saveState({
    messageId,
    lastStatus: status,
  });
}

/* ================= START ================= */

// El evento correcto es 'ready'
client.once("ready", async () => {
  console.log(`🤖 Bot conectado como ${client.user.tag}`);

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    
    // Ejecutar chequeo inicial
    await checkStatus(channel);

    // Configurar intervalo
    const interval = Number(CHECK_INTERVAL) || 30000;
    setInterval(() => {
      checkStatus(channel).catch(console.error);
    }, interval);

  } catch (error) {
    console.error("[CRITICAL ERROR] Error al obtener el canal:", error.message);
  }
});

client.login(DISCORD_TOKEN);