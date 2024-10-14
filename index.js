const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

let minTime = 5 * 60 * 1000;  // Default 5 minutes in ms
let maxTime = 20 * 60 * 1000; // Default 20 minutes in ms
let intervalId = null;
const soundFolder = path.join(__dirname, 'Sound Bites');
let lastPlayedClip = '';  // Store the name of the last played clip

// Initialize the bot and register commands
client.on('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  const commands = [
    new SlashCommandBuilder()
      .setName('wheresperry')
      .setDescription('Joins the voice channel of the user who typed the command'),
    new SlashCommandBuilder()
      .setName('theresperry')
      .setDescription('Leaves the voice channel of the user who typed the command'),
    new SlashCommandBuilder()
      .setName('whensperry')
      .setDescription('Sets the time bounds for random sound play intervals')
      .addIntegerOption(option =>
        option.setName('min')
          .setDescription('Minimum time in minutes')
          .setRequired(true))
      .addIntegerOption(option =>
        option.setName('max')
          .setDescription('Maximum time in minutes')
          .setRequired(true)),
    new SlashCommandBuilder()
      .setName('perrytheplatypus')
      .setDescription('Plays the specified sound clip')
      .addStringOption(option =>
        option.setName('clip')
          .setDescription('The name of the clip to play')
          .setRequired(true)),
    new SlashCommandBuilder()
      .setName('aplatypus')
      .setDescription('Adds a new sound clip from an attachment')
      .addStringOption(option =>
        option.setName('clip')
          .setDescription('The name to save the clip as')
          .setRequired(true))
      .addAttachmentOption(option =>
        option.setName('file')
          .setDescription('The file to upload as the sound clip')
          .setRequired(true)),
  ];

  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('Global slash commands registered');
  } catch (error) {
    console.error(error);
  }
});

// Handle the slash commands
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'wheresperry') {
    if (interaction.member.voice.channel) {
      const connection = joinVoiceChannel({
        channelId: interaction.member.voice.channel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });
      interaction.reply('Joined your voice channel!');
      
      // Start playing random sounds at intervals
      startRandomSound(connection);
    } else {
      interaction.reply('You need to be in a voice channel to use this command!');
    }
  } else if (commandName === 'theresperry') {
    const connection = getVoiceConnection(interaction.guild.id);
    if (connection) {
      clearInterval(intervalId); // Stop playing random sounds
      connection.destroy();
      interaction.reply('Left the voice channel!');
    } else {
      interaction.reply('I am not in a voice channel!');
    }
  } else if (commandName === 'whensperry') {
    const min = interaction.options.getInteger('min') * 60 * 1000;
    const max = interaction.options.getInteger('max') * 60 * 1000;
    if (min >= max) {
      interaction.reply('Minimum time must be less than maximum time.');
    } else {
      minTime = min;
      maxTime = max;
      interaction.reply(`Random intervals set between ${minTime / 60000} and ${maxTime / 60000} minutes.`);
    }
  } else if (commandName === 'perrytheplatypus') {
    const clipName = interaction.options.getString('clip');
    const clipPath = path.join(soundFolder, `${clipName}.mp3`);
    
    if (fs.existsSync(clipPath)) {
      const connection = getVoiceConnection(interaction.guild.id);
      if (connection) {
        playClip(connection, clipPath);
        interaction.reply(`Playing clip: ${clipName}`);
      } else {
        interaction.reply('I am not in a voice channel. Use /wheresperry to invite me first.');
      }
    } else {
      interaction.reply(`Clip "${clipName}" not found.`);
    }
  } else if (commandName === 'aplatypus') {
    const clipName = interaction.options.getString('clip');
    const attachment = interaction.options.getAttachment('file');
    const clipPath = path.join(soundFolder, `${clipName}.mp3`);

    // Use dynamic import for node-fetch
    const fetch = await import('node-fetch').then(module => module.default);

    // Download the file and save it as the specified clip name
    const response = await fetch(attachment.url);
    const fileStream = fs.createWriteStream(clipPath);
    response.body.pipe(fileStream);

    fileStream.on('finish', () => {
      interaction.reply(`Saved clip as "${clipName}"`);
    });

    fileStream.on('error', () => {
      interaction.reply('Failed to save the clip.');
    });
  }
});

// Function to play random sound at intervals
function startRandomSound(connection) {
  const player = createAudioPlayer();

  const playRandomSound = () => {
    // Get all sound files in the Sound Bites folder
    const soundFiles = fs.readdirSync(soundFolder).filter(file => file.endsWith('.mp3'));
    
    // Filter out the last played clip to avoid repeating
    const availableClips = soundFiles.filter(file => file !== lastPlayedClip);
    
    if (availableClips.length === 0) {
      return; // No clips available to play
    }

    // Pick a random clip that isn't the last one
    const randomClip = availableClips[Math.floor(Math.random() * availableClips.length)];
    const clipPath = path.join(soundFolder, randomClip);

    // Play the selected clip
    const resource = createAudioResource(clipPath, {
      inputType: 'ffmpeg',
      ffmpegPath: ffmpegPath // Use ffmpeg-static for the ffmpeg path
    });
    player.play(resource);
    connection.subscribe(player);

    // Store the last played clip
    lastPlayedClip = randomClip;

    // Set a random delay for the next sound
    const randomDelay = Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime;
    console.log(`Next sound will play in ${(randomDelay / 60000).toFixed(2)} minutes`);

    intervalId = setTimeout(playRandomSound, randomDelay);
  };

  playRandomSound();
}

// Function to play a specific clip
function playClip(connection, clipPath) {
  const player = createAudioPlayer();
  const resource = createAudioResource(clipPath, {
    inputType: 'ffmpeg',
    ffmpegPath: ffmpegPath // Use ffmpeg-static for the ffmpeg path
  });
  player.play(resource);
  connection.subscribe(player);
}

client.login(process.env.TOKEN);
