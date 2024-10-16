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

let intervalId = null;
let nextSoundTime = null;  // To store the next sound play time
const soundFolder = path.join(__dirname, 'Sound Bites');
let lastPlayedClip = '';  // Store the name of the last played clip
const serverRangesFile = path.join(__dirname, 'serverRanges.json');

// Load or initialize the server ranges (min/max time ranges)
let serverRanges = {};
if (fs.existsSync(serverRangesFile)) 
{
  serverRanges = JSON.parse(fs.readFileSync(serverRangesFile));
} 
else 
{
  fs.writeFileSync(serverRangesFile, JSON.stringify({}));
}

// Function to dynamically fetch the sound clip options from the "Sound Bites" folder
const getSoundFiles = () => fs.readdirSync(soundFolder).filter(file => file.endsWith('.mp3'));

// Helper function to save the server ranges to the JSON file
const saveServerRanges = () => 
{
  fs.writeFileSync(serverRangesFile, JSON.stringify(serverRanges, null, 2));
};

// Initialize the bot and register commands
client.on('ready', async () => 
{
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
      .setName('currentwhensperry')
      .setDescription('Displays the current time range for random sounds in this server'),
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

  try 
  {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('Global slash commands registered');
  } 
  catch (error) 
  {
    console.error(error);
  }
});

// Handle the slash commands
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;
  const guildId = interaction.guild.id;

  // Ensure server has a default range in place
  if (!serverRanges[guildId]) 
  {
    serverRanges[guildId] = { minTime: 5 * 60 * 1000, maxTime: 20 * 60 * 1000 };  // Defaults in ms
    saveServerRanges();
  }

  if (commandName === 'wheresperry') 
  {
    if (interaction.member.voice.channel) 
    {
      const connection = joinVoiceChannel(
      {
        channelId: interaction.member.voice.channel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });
      console.log(`Joined voice channel in server ${interaction.guild.name} (${interaction.guild.id})`);
      interaction.reply('Joined your voice channel!');
      
      // Start playing random sounds at intervals
      startRandomSound(connection, interaction.guild);
    } 
    else 
    {
      interaction.reply('You need to be in a voice channel to use this command!');
    }
  }
  else if (commandName === 'theresperry') 
    {
      const connection = getVoiceConnection(interaction.guild.id);
      if (connection) 
      {
        clearInterval(intervalId); // Stop playing random sounds
        connection.destroy();
        console.log(`Left voice channel in server ${interaction.guild.name} (${interaction.guild.id})`);
        interaction.reply('Left the voice channel!');
      } 
      else 
      {
        interaction.reply('I am not in a voice channel!');
      }
    } 
  else if (commandName === 'whensperry') 
    {
      const min = interaction.options.getInteger('min') * 60 * 1000;
      const max = interaction.options.getInteger('max') * 60 * 1000;
      if (min >= max) 
      {
        interaction.reply('Minimum time must be less than maximum time.');
      } 
      else 
      {
        serverRanges[guildId] = { minTime: min, maxTime: max };
        saveServerRanges();
        console.log(`Updated random interval range: ${min / 60000} to ${max / 60000} minutes in server ${interaction.guild.name}`);
        interaction.reply(`Random intervals set between ${min / 60000} and ${max / 60000} minutes.`);
        
        // Immediately pick a new random interval after setting the range
        if (intervalId) clearTimeout(intervalId); // Clear any existing intervals
        const randomDelay = Math.floor(Math.random() * (max - min + 1)) + min;
        nextSoundTime = Date.now() + randomDelay;
        intervalId = setTimeout(() => playRandomSound(getVoiceConnection(guild.id), guild), randomDelay);
        console.log(`Next sound in server ${guild.name} (${guild.id}) will play in ${(randomDelay / 60000).toFixed(2)} minutes`);
      }
    } 
    else if (commandName === 'currentwhensperry') 
    {
      const { minTime, maxTime } = serverRanges[guildId];
      interaction.reply(`The current time range for random sounds in this server is between ${minTime / 60000} and ${maxTime / 60000} minutes.`);
    } 
    else if (commandName === 'perrytheplatypus') 
    {
      await interaction.deferReply();  // Defer the reply to handle longer task

      const clipName = interaction.options.getString('clip');
      const stayInChannel = interaction.options.getBoolean('stay') || false;
      const clipPath = path.join(soundFolder, clipName);  // The clip name already contains the .mp3 extension
      
      if (fs.existsSync(clipPath)) 
      {
        let connection = getVoiceConnection(interaction.guild.id);
      
        if (!connection) 
        {
          if (interaction.member.voice.channel) 
          {
            connection = joinVoiceChannel(
            {
              channelId: interaction.member.voice.channel.id,
              guildId: interaction.guild.id,
              adapterCreator: interaction.guild.voiceAdapterCreator,
            });
            console.log(`Joined voice channel in server ${interaction.guild.name} to play ${clipName}`);
          } 
          else 
          {
            return interaction.reply('You need to be in a voice channel to use this command!');
          }
        }

        // Play the clip
        playClip(connection, clipPath, interaction, stayInChannel);
      } 
      else 
      {
        interaction.followUp(`Clip "${clipName}" not found.`);
      }
    } 
    else if (commandName === 'aplatypus') 
    {
      const clipName = interaction.options.getString('clip');
      const attachment = interaction.options.getAttachment('file');
      const clipPath = path.join(soundFolder, `${clipName}.mp3`);

      // Use dynamic import for node-fetch
      const fetch = await import('node-fetch').then(module => module.default);

      // Download the file and save it as the specified clip name
      const response = await fetch(attachment.url);
      const fileStream = fs.createWriteStream(clipPath);
      response.body.pipe(fileStream);

      fileStream.on('finish', async () => 
      {
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
              .setName('currentwhensperry')
              .setDescription('Displays the current time range for random sounds in this server'),
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
  
        try 
        {
          await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: updatedCommands }
          );
          console.log('Updated slash commands with new clip.');
        } 
        catch (error) 
        {
          console.error(error);
        }

        interaction.reply(`Saved clip as "${clipName}" and updated the available clips.`);
      });

      fileStream.on('error', () => 
      {
        interaction.reply('Failed to save the clip.');
      });
    } 
    else if (commandName === 'nextsoundtime') 
    {
      if (nextSoundTime) 
      {
        const timeLeft = nextSoundTime - Date.now();
        const timecode = new Date(nextSoundTime).toLocaleTimeString(interaction.locale);
        const unixTimestamp = Math.floor(nextSoundTime / 1000); // Get Unix timestamp

        if (timeLeft > 0) {
          interaction.reply(`Next sound will play at ${timecode} (${Math.floor(timeLeft / 60000)} minutes from now). Discord time: <t:${unixTimestamp}:R>`);
        } else {
          interaction.reply('A sound is about to play very soon!');
        }
      }   
      else 
      {
        interaction.reply('No sound is scheduled to play at the moment.');
      } 
    }
});

// Function to start playing random sounds at intervals
function startRandomSound(connection, guild) 
{
  const { minTime, maxTime } = serverRanges[guild.id];

  // Set up random sound playing
  playRandomSound(connection, guild); // Pass the correct arguments
}

function playRandomSound(connection, guild) {
  console.log("Attempting to play random sound...");

  const player = createAudioPlayer();
  const soundFiles = getSoundFiles(); // Get all sound files

  let availableClips = soundFiles.filter(file => file !== lastPlayedClip); // Filter last clip
  if (availableClips.length === 0 && soundFiles.length === 1) 
  {
    // If there's only one sound file, play it even if it was the last played clip
    availableClips = soundFiles;
  }
  
  if (availableClips.length === 0) 
  {
    console.log("No available clips to play.");
    return; // If no available clips, exit
  }
  

  const randomClip = availableClips[Math.floor(Math.random() * availableClips.length)];
  const clipPath = path.join(soundFolder, randomClip);

  console.log(`Playing clip: ${randomClip}`);

  const resource = createAudioResource(clipPath, {
    inputType: 'ffmpeg',
    ffmpegPath: ffmpegPath,
  });
  player.play(resource);
  connection.subscribe(player);

  lastPlayedClip = randomClip; // Store last played clip

  player.once(AudioPlayerStatus.Idle, () => {
    console.log(`Clip ${randomClip} finished playing.`);
    const { minTime, maxTime } = serverRanges[guild.id]; // Get min/max times
    const randomDelay = Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime;
    nextSoundTime = Date.now() + randomDelay;
    console.log(`Next sound will play in ${randomDelay / 60000} minutes`);

    intervalId = setTimeout(() => startRandomSound(connection, guild), randomDelay);
  });
}

// Function to play a specific clip and leave the voice channel if necessary
function playClip(connection, clipPath, interaction, stayInChannel) 
{
  const player = createAudioPlayer();
  const resource = createAudioResource(clipPath, 
  {
    inputType: 'ffmpeg',
    ffmpegPath: ffmpegPath // Use ffmpeg-static for the ffmpeg path
  });
  
  player.play(resource);
  connection.subscribe(player);

  player.once(AudioPlayerStatus.Idle, async () => 
  {
    if (!stayInChannel) 
    {
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
    } 
    else 
    {
      await interaction.followUp('Finished playing the clip and stayed in the voice channel as requested.');
    }
  });
}

client.login(process.env.TOKEN);
