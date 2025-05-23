/**
 * @ai-guide-component GetQualitiesCommand
 * @ai-guide-description Video stream quality analyzer
 * @ai-guide-responsibilities
 * - Analyzes video streams for available quality options
 * - Uses FFprobe to extract stream metadata
 * - Identifies resolution, bitrate, and codec information
 * - Parses HLS/DASH manifests for variant streams
 * - Maps technical stream data to user-friendly quality labels
 * - Returns structured quality options to the extension UI
 * - Handles various streaming protocol formats
 */

// commands/get-qualities.js
const { spawn } = require('child_process');
const BaseCommand = require('./base-command');
const { logDebug } = require('../utils/logger');
const { getFullEnv } = require('../utils/resources');

/**
 * Command for analyzing media streams and getting available qualities
 */
class GetQualitiesCommand extends BaseCommand {
    /**
     * Execute the getQualities command
     * @param {Object} params Command parameters
     * @param {string} params.url Video URL to analyze
     * @param {boolean} [params.light] Whether to do light analysis only
     */
    async execute(params) {
        const { url, light = false, headers = {} } = params;
        logDebug('🎥 Analyzing media from:', url, light ? '(light mode)' : '(full mode)');
        
        // Skip for blob URLs
        if (url.startsWith('blob:')) {
            logDebug('❌ Cannot analyze blob URLs');
            this.sendError('Cannot analyze blob URLs');
            return { error: 'Cannot analyze blob URLs' };
        }
        
        // Log received headers
        if (headers && Object.keys(headers).length > 0) {
            logDebug('🔑 Received headers:', headers);
        }
        
        try {
            // If light parsing is requested and this is a streaming URL (HLS/DASH),
            // we can determine if it's a master playlist much more quickly
            if (light && (url.includes('.m3u8') || url.includes('.mpd'))) {
                logDebug('🔎 Performing light analysis to determine manifest type');
                const lightResult = await this.performLightAnalysis(url);
                
                if (lightResult.success) {
                    this.sendSuccess(lightResult);
                    return lightResult;
                }
                
                // If light analysis failed but we want full analysis, continue
                if (!lightResult.success && !lightResult.needsFullParsing) {
                    this.sendError('Light analysis failed: ' + (lightResult.error || 'Unknown error'));
                    return lightResult;
                }
            }
            
            // Get required services
            const ffmpegService = this.getService('ffmpeg');
            
            // Format headers for FFprobe if available
            let headerArg = '';
            if (headers && Object.keys(headers).length > 0) {
                // Format headers for FFprobe as "Key: Value\r\n" pairs
                headerArg = Object.entries(headers)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join('\r\n') + '\r\n';
                
                logDebug(`🔑 Using headers for FFprobe command: ${headerArg}`);
            }
            
            return new Promise((resolve, reject) => {
                // Build FFprobe args
                const ffprobeArgs = [
                    '-v', 'quiet',
                    '-print_format', 'json',
                    '-show_streams',
                    '-show_format'
                ];
                
                // Add headers if provided
                if (headers && Object.keys(headers).length > 0) {
                    // Format headers for FFprobe as "Key: Value\r\n" pairs
                    const headerLines = Object.entries(headers)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join('\r\n');
                    
                    if (headerLines) {
                        ffprobeArgs.push('-headers', headerLines + '\r\n');
                        logDebug('🔑 Using headers for FFprobe request');
                    }
                }
                
                // Add headers if provided
                if (headers && Object.keys(headers).length > 0) {
                    // Format headers for FFprobe as "Key: Value\r\n" pairs
                    const headerLines = Object.entries(headers)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join('\r\n');
                    
                    if (headerLines) {
                        ffprobeArgs.push('-headers', headerLines + '\r\n');
                        logDebug('🔑 Using headers for FFprobe request');
                    }
                }
                
                // Add URL as the last argument
                ffprobeArgs.push(url);
                
                const ffprobe = spawn(ffmpegService.getFFprobePath(), ffprobeArgs, { env: getFullEnv() });
    
                let output = '';
                let errorOutput = '';
    
                ffprobe.stdout.on('data', (data) => {
                    output += data;
                });
    
                ffprobe.stderr.on('data', (data) => {
                    errorOutput += data;
                });
    
                ffprobe.on('close', (code) => {
                    if (code === 0 && output) {
                        try {
                            const info = JSON.parse(output);
                            const videoStream = info.streams.find(s => s.codec_type === 'video');
                            const audioStream = info.streams.find(s => s.codec_type === 'audio');
                            
                            const streamInfo = {
                                format: info.format?.format_name || 'unknown',
                                container: info.format?.format_long_name || 'unknown'
                            };
    
                            logDebug('📊 Media analysis results:');
                            logDebug(`Container: ${streamInfo.container}`);
                            
                            // Video stream info
                            if (videoStream) {
                                streamInfo.width = parseInt(videoStream.width) || null;
                                streamInfo.height = parseInt(videoStream.height) || null;
                                streamInfo.hasVideo = true;
                                streamInfo.videoCodec = {
                                    name: videoStream.codec_name || 'unknown',
                                    longName: videoStream.codec_long_name || 'unknown',
                                    profile: videoStream.profile || null,
                                    pixFmt: videoStream.pix_fmt || null,
                                    colorSpace: videoStream.color_space || null,
                                    bitDepth: videoStream.bits_per_raw_sample || null
                                };
                                
                                // Calculate framerate
                                let fps = null;
                                try {
                                    if (videoStream.r_frame_rate) {
                                        const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
                                        if (den && num) fps = Math.round(num / den);
                                    } else if (videoStream.avg_frame_rate) {
                                        const [num, den] = videoStream.avg_frame_rate.split('/').map(Number);
                                        if (den && num) fps = Math.round(num / den);
                                    }
                                } catch (e) {
                                    logDebug('⚠️ Error parsing framerate:', e);
                                }
                                streamInfo.fps = fps;
    
                                // Get video bitrate
                                if (videoStream.bit_rate) {
                                    streamInfo.videoBitrate = parseInt(videoStream.bit_rate);
                                }
                                
                                logDebug('🎬 Video stream:', {
                                    codec: streamInfo.videoCodec.name,
                                    resolution: `${streamInfo.width}x${streamInfo.height}`,
                                    fps: `${streamInfo.fps}fps`,
                                    bitrate: streamInfo.videoBitrate ? `${(streamInfo.videoBitrate / 1000000).toFixed(2)}Mbps` : 'unknown'
                                });
                            } else {
                                streamInfo.hasVideo = false;
                                logDebug('ℹ️ No video stream found');
                            }
                            
                            // Audio stream info
                            if (audioStream) {
                                streamInfo.hasAudio = true;
                                streamInfo.audioCodec = {
                                    name: audioStream.codec_name || 'unknown',
                                    longName: audioStream.codec_long_name || 'unknown',
                                    profile: audioStream.profile || null,
                                    sampleRate: parseInt(audioStream.sample_rate) || null,
                                    channels: parseInt(audioStream.channels) || null,
                                    channelLayout: audioStream.channel_layout || null,
                                    bitDepth: audioStream.bits_per_raw_sample || null
                                };
                                
                                if (audioStream.bit_rate) {
                                    streamInfo.audioBitrate = parseInt(audioStream.bit_rate);
                                }
                                
                                logDebug('🔊 Audio stream:', {
                                    codec: streamInfo.audioCodec.name,
                                    channels: streamInfo.audioCodec.channels,
                                    sampleRate: streamInfo.audioCodec.sampleRate ? `${streamInfo.audioCodec.sampleRate}Hz` : 'unknown',
                                    bitrate: streamInfo.audioBitrate ? `${(streamInfo.audioBitrate / 1000).toFixed(0)}kbps` : 'unknown'
                                });
                            } else {
                                streamInfo.hasAudio = false;
                                logDebug('ℹ️ No audio stream found');
                            }
                            
                            // Total bitrate from format if available
                            if (info.format.bit_rate) {
                                streamInfo.totalBitrate = parseInt(info.format.bit_rate);
                            }
                            
                            // Duration if available
                            if (info.format.duration) {
                                streamInfo.duration = Math.round(parseFloat(info.format.duration));
                                const hours = Math.floor(streamInfo.duration / 3600);
                                const minutes = Math.floor((streamInfo.duration % 3600) / 60);
                                const seconds = streamInfo.duration % 60;
                                if (hours > 0) {
                                    logDebug(`⏱️ Duration: ${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
                                } else {
                                    logDebug(`⏱️ Duration: ${minutes}:${seconds.toString().padStart(2, '0')}`);
                                }
                            }
                            
                            // File size if available
                            if (info.format.size) {
                                streamInfo.sizeBytes = parseInt(info.format.size);
                                const sizeMB = (streamInfo.sizeBytes / (1024 * 1024)).toFixed(1);
                                logDebug(`📦 Size: ${sizeMB}MB`);
                            }
                            
                            // Calculate estimated size based on bitrate and duration if exact size not available
                            if (streamInfo.totalBitrate && streamInfo.duration) {
                                // Formula: (bitrate in bps * duration in seconds) / 8 = bytes
                                streamInfo.estimatedFileSizeBytes = Math.round((streamInfo.totalBitrate * streamInfo.duration) / 8);
                                const sizeMB = (streamInfo.estimatedFileSizeBytes / (1024 * 1024)).toFixed(1);
                                logDebug(`📊 Estimated size: ${sizeMB}MB (based on bitrate × duration)`);
                            }
                            
                            // Mark as fully parsed
                            streamInfo.isFullyParsed = true;
                            
                            // Note: This ffprobe-derived metadata takes priority over JavaScript-parsed manifest data
                            // The video-manager.js handles merging with proper priority
                            
                            this.sendSuccess({ streamInfo });
                            logDebug('✅ Media analysis complete');
                            resolve({ success: true, streamInfo });
                            
                        } catch (error) {
                            logDebug('❌ Error parsing FFprobe output:', error);
                            this.sendError('Failed to parse stream info');
                            resolve({ error: 'Failed to parse stream info' });
                        }
                    } else {
                        logDebug('❌ FFprobe failed with code:', code, 'Error:', errorOutput);
                        this.sendError('Failed to analyze video');
                        resolve({ error: 'Failed to analyze video' });
                    }
                });
    
                ffprobe.on('error', (err) => {
                    logDebug('❌ FFprobe spawn error:', err);
                    this.sendError('Failed to start FFprobe: ' + err.message);
                    resolve({ error: 'Failed to start FFprobe: ' + err.message });
                });
            });
        } catch (err) {
            logDebug('❌ GetQualities error:', err);
            this.sendError(err.message);
            return { error: err.message };
        }
    }

    /**
     * Perform light analysis to determine if a streaming URL is a master playlist
     * without doing full ffprobe analysis
     * @param {string} url URL to analyze
     * @returns {Promise<Object>} Basic info result
     */
    async performLightAnalysis(url) {
        try {
            // Determine the type from extension
            const type = url.includes('.m3u8') ? 'hls' : url.includes('.mpd') ? 'dash' : 'unknown';
            
            logDebug(`🔎 [LIGHT-ANALYSIS] Starting light analysis for ${url} (${type})`);
            
            // Use the manifest parser to check the first portion of the file
            const manifestParser = this.getService('manifest-parser') || {
                lightParse: async (url, type) => {
                    // Very basic fetch implementation if service not available
                    const https = require('https');
                    const http = require('http');
                    const { URL } = require('url');
                    
                    return new Promise((resolve) => {
                        try {
                            const urlObj = new URL(url);
                            const protocol = urlObj.protocol === 'https:' ? https : http;
                            
                            const options = {
                                method: 'GET',
                                hostname: urlObj.hostname,
                                path: urlObj.pathname + urlObj.search,
                                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                                timeout: 5000,
                                headers: {
                                    'Range': 'bytes=0-2047', // Just get first 2KB
                                    'User-Agent': headers?.['User-Agent'] || 'Mozilla/5.0',
                                    'Accept': '*/*',
                                    'Referer': headers?.['Referer'] || undefined
                                }
                            };
                            
                            const req = protocol.request(options, (res) => {
                                let data = '';
                                res.on('data', (chunk) => {
                                    data += chunk.toString();
                                });
                                
                                res.on('end', () => {
                                    // Basic detection
                                    if (type === 'hls') {
                                        const isMaster = data.includes('#EXT-X-STREAM-INF:');
                                        resolve({
                                            isMaster: isMaster,
                                            isVariant: !isMaster,
                                            type: 'hls',
                                            format: 'hls', 
                                            isLightParsed: true
                                        });
                                    } else if (type === 'dash') {
                                        const isMaster = data.includes('<AdaptationSet') && 
                                                        data.includes('<Representation');
                                        resolve({
                                            isMaster: isMaster,
                                            isVariant: !isMaster,
                                            type: 'dash',
                                            format: 'dash',
                                            isLightParsed: true
                                        });
                                    } else {
                                        resolve(null);
                                    }
                                });
                            });
                            
                            req.on('error', () => resolve(null));
                            req.end();
                        } catch (error) {
                            resolve(null);
                        }
                    });
                }
            };
            
            const result = await manifestParser.lightParse(url, type);
            
            if (result) {
                logDebug(`🔎 [LIGHT-ANALYSIS] Success for ${url}: isMaster=${result.isMaster}, isVariant=${result.isVariant}`);
                return { 
                    success: true,
                    streamInfo: {
                        ...result,
                        hasVideo: true,
                        hasAudio: true,
                        container: type
                    }
                };
            }
            
            // If light parsing fails, indicate that full parsing is needed
            return { success: false, needsFullParsing: true };
        } catch (error) {
            logDebug('Error in light analysis:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = GetQualitiesCommand;
