const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Collection } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, AudioPlayerStatus } = require('@discordjs/voice');
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
let nextSoundTime = null;  // To store the next sound play time
const soundFolder = path.join(__dirname, 'Sound Bites');
let lastPlayedClip = '';  // Store the name of the last played clip

// Function to dynamically fetch the sound clip options from the "Sound Bites" folder
const getSoundFiles = () => fs.readdirSync(soundFolder).filter(file => file.endsWith('.mp3'));

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
      .setDescription('Plays the specified sound clip and optionally stays in the voice channel afterwards')
      .addStringOption(option =>
        option.setName('clip')
          .setDescription('The name of the clip to play')
          .setRequired(true)
          .addChoices(...getSoundFiles().map(file => ({ name: file.replace('.mp3', ''), value: file }))))
      .addBooleanOption(option =>
        option.setName('stay')
          .setDescription('Should the bot stay in the voice channel after playing the clip?')),
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
    new SlashCommandBuilder()
      .setName('nextsoundtime')
      .setDescription('Displays the time until the next random sound is played'),
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
      console.log(`Joined voice channel in server ${interaction.guild.name} (${interaction.guild.id})`);
      interaction.reply('Joined your voice channel!');
      
      // Start playing random sounds at intervals
      startRandomSound(connection, interaction.guild);
    } else {
      interaction.reply('You need to be in a voice channel to use this command!');
    }
  } else if (commandName === 'theresperry') {
    const connection = getVoiceConnection(interaction.guild.id);
    if (connection) {
      clearInterval(intervalId); // Stop playing random sounds
      connection.destroy();
      console.log(`Left voice channel in server ${interaction.guild.name} (${interaction.guild.id})`);
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
      console.log(`Updated random interval range: ${minTime / 60000} to ${maxTime / 60000} minutes in server ${interaction.guild.name}`);
      interaction.reply(`Random intervals set between ${minTime / 60000} and ${maxTime / 60000} minutes.`);
      
      // Immediately pick a new random interval after setting the range
      if (intervalId) clearTimeout(intervalId); // Clear any existing intervals
      const randomDelay = Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime;
      nextSoundTime = Date.now() + randomDelay;
      intervalId = setTimeout(() => playRandomSound(getVoiceConnection(interaction.guild.id), interaction.guild), randomDelay);
      console.log(`Next sound in server ${interaction.guild.name} (${interaction.guild.id}) will play in ${(randomDelay / 60000).toFixed(2)} minutes`);
    }
  } else if (commandName === 'perrytheplatypus') {
    await interaction.deferReply();  // Defer the reply to handle longer task

    const clipName = interaction.options.getString('clip');
    const stayInChannel = interaction.options.getBoolean('stay') || false;
    const clipPath = path.join(soundFolder, clipName);  // The clip name already contains the .mp3 extension
    
    if (fs.existsSync(clipPath)) {
      let connection = getVoiceConnection(interaction.guild.id);
      
      if (!connection) {
        if (interaction.member.voice.channel) {
          connection = joinVoiceChannel({
            channelId: interaction.member.voice.channel.id,
            guildId: interaction.guild.id,
            adapterCreator: interaction.guild.voiceAdapterCreator,
          });
          console.log(`Joined voice channel in server ${interaction.guild.name} to play ${clipName}`);
        } else {
          return interaction.reply('You need to be in a voice channel to use this command!');
        }
      }

      // Play the clip
      playClip(connection, clipPath, interaction, stayInChannel);
    } else {
      interaction.followUp(`Clip "${clipName}" not found.`);
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

    fileStream.on('finish', async () => {
      // Update the command options with the newly added clip
      const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
      const updatedCommands = [
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
          .setDescription('Plays the specified sound clip and optionally stays in the voice channel afterwards')
          .addStringOption(option =>
            option.setName('clip')
              .setDescription('The name of the clip to play')
              .setRequired(true)
              .addChoices(...getSoundFiles().map(file => ({ name: file.replace('.mp3', ''), value: file }))))
          .addBooleanOption(option =>
            option.setName('stay')
              .setDescription('Should the bot stay in the voice channel after playing the clip?')),
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
        new SlashCommandBuilder()
          .setName('nextsoundtime')
          .setDescription('Displays the time until the next random sound is played'),
      ];
  
      try {
        await rest.put(
          Routes.applicationCommands(client.user.id),
          { body: updatedCommands }
        );
        console.log('Updated slash commands with new clip.');
      } catch (error) {
        console.error(error);
      }

      interaction.reply(`Saved clip as "${clipName}" and updated the available clips.`);
    });

    fileStream.on('error', () => {
      interaction.reply('Failed to save the clip.');
    });
  } else if (commandName === 'nextsoundtime') {
    if (nextSoundTime) {
      const timeLeft = nextSoundTime - Date.now();
      const timecode = new Date(nextSoundTime).toLocaleTimeString(interaction.locale);
      if (timeLeft > 0) {
        interaction.reply(`Next sound will play at ${timecode} (${Math.floor(timeLeft / 60000)} minutes from now).`);
      } else {
        interaction.reply('A sound is about to play very soon!');
      }
    } else {
      interaction.reply('No sound is scheduled to play at the moment.');
    }
  }
});

// Function to play random sound at intervals
function startRandomSound(connection, guild) {
  const player = createAudioPlayer();

  const playRandomSound = () => {
    // Get all sound files in the Sound Bites folder
    const soundFiles = getSoundFiles();
    
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

    // Set a new random delay for the next sound after the current one finishes playing
    player.once(AudioPlayerStatus.Idle, () => {
      const randomDelay = Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime;
      nextSoundTime = Date.now() + randomDelay;  // Set the time for the next sound
      console.log(`Next sound in server ${guild.name} (${guild.id}) will play in ${(randomDelay / 60000).toFixed(2)} minutes`);

      // Schedule the next sound
      intervalId = setTimeout(playRandomSound, randomDelay);
    });
  };

  playRandomSound();
}

// Function to play a specific clip and leave the voice channel if necessary
function playClip(connection, clipPath, interaction, stayInChannel) {
  const player = createAudioPlayer();
  const resource = createAudioResource(clipPath, {
    inputType: 'ffmpeg',
    ffmpegPath: ffmpegPath // Use ffmpeg-static for the ffmpeg path
  });
  
  player.play(resource);
  connection.subscribe(player);

  player.once(AudioPlayerStatus.Idle, async () => {
    if (!stayInChannel) {
      // After playing, check if anyone is still in the voice channel
      const channel = connection.joinConfig.channelId;
      const vcChannel = interaction.guild.channels.cache.get(channel);
    
      if (vcChannel.members.size === 1) {  // Only the bot is in the channel
        connection.destroy();
        await interaction.followUp('Left the voice channel as no one else is here.');
      } else {
        connection.destroy();
        await interaction.followUp('Finished playing the clip and left the voice channel.');
      }
    } else {
      await interaction.followUp('Finished playing the clip and stayed in the voice channel as requested.');
    }
  });
}

client.login(process.env.TOKEN);
