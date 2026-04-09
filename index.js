const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { Client, GatewayIntentBits } = require('discord.js');
console.log('WEBHOOK VERSION 2');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const discord = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const BOOKING_CHANNEL_ID = process.env.BOOKING_CHANNEL_ID;

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

app.get('/', (_req, res) => {
  res.send('Webhook is live');
});

app.post('/calendly-webhook', async (req, res) => {
  try {
    const event = req.body.event;

    if (event !== 'invitee.created') {
      return res.status(200).send('Ignored');
    }

    const payload = req.body.payload;
    const email = payload.email?.toLowerCase();
    const startTime = payload.scheduled_event?.start_time;

    const { data: client, error: fetchError } = await supabase
      .from('clients')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (fetchError) {
      console.error(fetchError);
      return res.status(500).send('Database fetch error');
    }

    if (!client) {
      return res.status(200).send('Client not found');
    }

    const { data: updated, error: updateError } = await supabase
      .from('clients')
      .update({
        sessions_used: client.sessions_used + 1,
        booked_this_month: client.booked_this_month + 1
      })
      .eq('email', email)
      .select()
      .single();

    if (updateError) {
      console.error(updateError);
      return res.status(500).send('Database update error');
    }

    const remaining = updated.sessions_total - updated.sessions_used;
    const { date, time } = formatDateTime(startTime);

    const message =
`${updated.name} has booked for ${date} at ${time}.
Sessions remaining: ${remaining}

Email: ${updated.email}
Phone: ${updated.phone}
Booked this month: ${updated.booked_this_month}`;

    const channel = await discord.channels.fetch(BOOKING_CHANNEL_ID);
    await channel.send(message);

    res.status(200).send('Success');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error');
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
