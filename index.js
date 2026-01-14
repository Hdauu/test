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
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/* ================= CHECKS ================= */

function checkPort(host, port, timeout = 3000) {
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
      .once("error", () => resolve(false))
      .connect(port, host);
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
    } catch {
      // mensaje borrado o sin permisos
    }
  }

  const msg = await channel.send(text);
  return msg.id;
}

async function sendPing(channel, text) {
  const msg = await channel.send({
    content: `@everyone ${text}`,
    allowedMentions: { parse: ["everyone"] },
  });

  // borrar el ping luego de 15s
  setTimeout(() => msg.delete().catch(() => {}), 15000);
}

/* ================= STATUS LOGIC ================= */

async function checkStatus(channel) {
  const state = loadState();
  const online = await checkPort(SERVER_HOST, Number(SERVER_PORT));

  let status;
  let text;

  if (!online) {
    status = "DOWN";
    text = "Actualmente Caído - 🔴";
  } else {
    const cpu = getCpuUsage();
    const ram = getRamUsage();

    if (cpu >= Number(CPU_WARN) || ram >= Number(RAM_WARN)) {
      status = "WARN";
      text = "Actualmente con problemas de rendimiento - 🟡";
    } else {
      status = "OK";
      text = "Funcionando correctamente - 🟢";
    }
  }

  console.log(
    `[CHECK] ${new Date().toLocaleTimeString()} | ${status}`
  );

  // 🔥 SE EDITA SIEMPRE
  const messageId = await updateStatusMessage(channel, text, state);

  // 🔔 PING SOLO SI CAMBIÓ A WARN O DOWN
  if (status !== state.lastStatus && state.lastStatus !== null) {
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

client.once("clientReady", async () => {
  console.log(`🤖 Bot conectado como ${client.user.tag}`);

  const channel = await client.channels.fetch(CHANNEL_ID);

  // primer chequeo
  await checkStatus(channel);

  // interval fijo
  setInterval(() => {
    checkStatus(channel).catch(console.error);
  }, Number(CHECK_INTERVAL));
});

client.login(DISCORD_TOKEN);
