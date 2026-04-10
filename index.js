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

const ALLOWED_EVENT_LOCATIONS = {
  'The Toronto Content Lab (North York)': 'North York',
  'The Toronto Content Lab (Mississauga)': 'Mississauga'
};

function currentMonthKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function formatDateTime(startTime) {
  const dt = new Date(startTime);

  return {
    date: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(dt),
    time: new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Toronto',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(dt)
  };
}

function getEventName(payload) {
  return String(
    payload.scheduled_event?.name ||
    payload.event_type?.name ||
    ''
  ).trim();
}

function getEventLocation(eventName) {
  return ALLOWED_EVENT_LOCATIONS[eventName] || '';
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
      last_reset_month: currentMonthKey(),
      notes: ''
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
  if (c.sessions_used > c.sessions_total) {
    return `Over limit. This client is at ${c.sessions_used}/${c.sessions_total}.`;
  }

  if (c.sessions_used === c.sessions_total) {
    return `Limit reached. This client is at ${c.sessions_used}/${c.sessions_total}.`;
  }

  if (c.sessions_used === c.sessions_total - 1) {
    return `Renewal soon. This client is at ${c.sessions_used}/${c.sessions_total}.`;
  }

  return '';
}

discord.once('ready', () => {
  console.log(`Discord helper logged in as ${discord.user.tag}`);
});

discord.login(process.env.BOT_TOKEN);

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
    const eventName = getEventName(payload);
    const location = getEventLocation(eventName);

    if (!location) {
      return res.status(200).send(`Ignored event: ${eventName || 'Unknown event'}`);
    }

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
`New client

Name: ${client.name}
Email: ${client.email}
Default sessions: ${client.sessions_total}`
      );
    }

    if (client.sessions_used >= client.sessions_total) {
      await sendDiscordMessage(
`Booking alert: ${client.name} booked, but they are already at ${client.sessions_used}/${client.sessions_total}.

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

    const { date, time } = formatDateTime(startTime);
    const statusMessage = getUsageStatusMessage(updated);

    const message = [
      'New studio booking',
      '',
      `Name: ${updated.name}`,
      `Date: ${date}`,
      `Time: ${time}`,
      `Location: ${location}`,
      statusMessage ? `Note: ${statusMessage}` : ''
    ].filter(Boolean).join('\n');

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
