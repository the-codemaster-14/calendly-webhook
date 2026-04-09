const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DEFAULT_NEW_CLIENT_SESSIONS = Number(process.env.DEFAULT_NEW_CLIENT_SESSIONS || 6);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const discord = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const BOOKING_CHANNEL_ID = process.env.BOOKING_CHANNEL_ID;

function currentMonthKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

discord.once('ready', () => {
  console.log(`Discord helper logged in as ${discord.user.tag}`);
});

discord.login(process.env.BOT_TOKEN);

function formatDateTime(startTime) {
  const dt = new Date(startTime);
  return {
    date: dt.toLocaleDateString(),
    time: dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
}

async function getClientByEmail(email) {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function createClientRecord({ name, email }) {
  const { data, error } = await supabase
    .from('clients')
    .insert([{
      name,
      phone: '',
      email: email.toLowerCase(),
      sessions_used: 0,
      sessions_total: DEFAULT_NEW_CLIENT_SESSIONS,
      booked_this_month: 0,
      last_reset_month: currentMonthKey()
    }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateClientByEmail(email, updates) {
  const { data, error } = await supabase
    .from('clients')
    .update(updates)
    .eq('email', email.toLowerCase())
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function sendDiscordMessage(text) {
  const channel = await discord.channels.fetch(BOOKING_CHANNEL_ID);
  await channel.send(text);
}

function getUsageStatusMessage(c) {
  const remaining = c.sessions_total - c.sessions_used;

  if (c.sessions_used > c.sessions_total) {
    return `❌ Over limit. This client is at ${c.sessions_used}/${c.sessions_total}.`;
  }

  if (c.sessions_used === c.sessions_total) {
    return `❗ Limit reached. This client is at ${c.sessions_used}/${c.sessions_total}.`;
  }

  if (c.sessions_used === c.sessions_total - 1) {
    return `⚠ Renewal soon. This client is at ${c.sessions_used}/${c.sessions_total}.`;
  }

  return `Sessions remaining: ${remaining}`;
}

app.get('/', (_req, res) => {
  res.send('Webhook is live');
});

app.post('/calendly-webhook', async (req, res) => {
  try {
    const event = req.body.event;

    if (event !== 'invitee.created') {
      return res.status(200).send('Ignored');
    }

    const payload = req.body.payload || {};
    const email = payload.email?.toLowerCase();
    const startTime = payload.scheduled_event?.start_time;
    const name = payload.name || 'New Client';

    if (!email || !startTime) {
      return res.status(400).send('Missing required booking data');
    }

    let client = await getClientByEmail(email);

    if (!client) {
      client = await createClientRecord({ name, email });

      await sendDiscordMessage(
`🆕 Auto-created new client from Calendly booking.

Name: ${client.name}
Email: ${client.email}
Default sessions: ${client.sessions_total}`
      );
    }

    if (client.sessions_used >= client.sessions_total) {
      await sendDiscordMessage(
`❌ Booking alert: ${client.name} booked, but they are already at ${client.sessions_used}/${client.sessions_total}.

Email: ${client.email}
Please review or renew this client manually.`
      );

      return res.status(200).send('Client over limit');
    }

    const updated = await updateClientByEmail(email, {
      sessions_used: client.sessions_used + 1,
      booked_this_month: client.booked_this_month + 1,
      last_reset_month: currentMonthKey()
    });

    const remaining = updated.sessions_total - updated.sessions_used;
    const { date, time } = formatDateTime(startTime);

    const message =
`${updated.name} has booked for ${date} at ${time}.
Sessions remaining: ${remaining}

Email: ${updated.email}
Phone: ${updated.phone || ''}
Booked this month: ${updated.booked_this_month}
${getUsageStatusMessage(updated)}`;

    await sendDiscordMessage(message);

    return res.status(200).send('Success');
  } catch (err) {
    console.error(err);
    return res.status(500).send('Error');
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
