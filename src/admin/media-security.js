const { createLogger } = require('../utils');

const logger = createLogger('MediaSecurity');

const dangerousExtensions = [
  // Executable files
  'exe', 'bat', 'cmd', 'com', 'pif', 'scr', 'vbs', 'js', 'jar',
  // Scripts
  'sh', 'bash', 'ps1', 'psm1', 'py', 'rb', 'pl', 'php',
  // System files
  'sys', 'dll', 'drv', 'cpl',
  // Malware common extensions
  'msi', 'apk', 'app', 'deb', 'rpm',
  // Compressed with potential malware
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2',
  // Office macros
  'docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'potm',
  // Database
  'sql', 'db', 'sqlite', 'mdb',
  // Others
  'html', 'htm', 'hta', 'reg', 'inf'
];

const suspiciousExtensions = [
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'pdf', 'rtf', 'odt', 'ods', 'odp'
];

const maxFileSizes = {
  photo: 20 * 1024 * 1024,        // 20 MB
  video: 50 * 1024 * 1024,        // 50 MB
  video_note: 50 * 1024 * 1024,   // 50 MB
  voice: 20 * 1024 * 1024,        // 20 MB
  audio: 50 * 1024 * 1024,        // 50 MB
  document: 20 * 1024 * 1024,     // 20 MB (default)
  animation: 20 * 1024 * 1024,    // 20 MB
  sticker: 10 * 1024 * 1024,      // 10 MB
};

const maxFileSizesPremium = {
  photo: 50 * 1024 * 1024,        // 50 MB
  video: 200 * 1024 * 1024,       // 200 MB
  video_note: 100 * 1024 * 1024,  // 100 MB
  voice: 50 * 1024 * 1024,        // 50 MB
  audio: 100 * 1024 * 1024,       // 100 MB
  document: 100 * 1024 * 1024,    // 100 MB
  animation: 50 * 1024 * 1024,    // 50 MB
  sticker: 20 * 1024 * 1024,      // 20 MB
};

function getFileExtension(filename) {
  if (!filename) return null;
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : null;
}

function isDangerousFile(filename) {
  const ext = getFileExtension(filename);
  if (!ext) return false;
  
  return dangerousExtensions.includes(ext);
}

function isSuspiciousFile(filename) {
  const ext = getFileExtension(filename);
  if (!ext) return false;
  
  return suspiciousExtensions.includes(ext);
}

function checkFileSize(fileSize, mediaType, isPremium = false) {
  const limits = isPremium ? maxFileSizesPremium : maxFileSizes;
  const maxSize = limits[mediaType] || limits.document;
  
  return {
    isValid: fileSize <= maxSize,
    fileSize,
    maxSize,
    exceedsBy: fileSize > maxSize ? fileSize - maxSize : 0
  };
}

async function validateMedia(ctx, isPremium = false) {
  const message = ctx.message;
  let mediaType = null;
  let fileName = null;
  let fileSize = 0;
  let mimeType = null;

  // Detect media type and get file info
  if (message.document) {
    mediaType = 'document';
    fileName = message.document.file_name;
    fileSize = message.document.file_size;
    mimeType = message.document.mime_type;
  } else if (message.video) {
    mediaType = 'video';
    fileName = message.video.file_name || 'video.mp4';
    fileSize = message.video.file_size;
    mimeType = message.video.mime_type;
  } else if (message.audio) {
    mediaType = 'audio';
    fileName = message.audio.file_name || 'audio.mp3';
    fileSize = message.audio.file_size;
    mimeType = message.audio.mime_type;
  } else if (message.photo) {
    mediaType = 'photo';
    const largestPhoto = message.photo[message.photo.length - 1];
    fileSize = largestPhoto.file_size;
    fileName = 'photo.jpg';
  } else if (message.voice) {
    mediaType = 'voice';
    fileSize = message.voice.file_size;
    fileName = 'voice.ogg';
    mimeType = message.voice.mime_type;
  } else if (message.video_note) {
    mediaType = 'video_note';
    fileSize = message.video_note.file_size;
    fileName = 'video_note.mp4';
  } else if (message.animation) {
    mediaType = 'animation';
    fileSize = message.animation.file_size;
    fileName = message.animation.file_name || 'animation.gif';
    mimeType = message.animation.mime_type;
  } else if (message.sticker) {
    mediaType = 'sticker';
    fileSize = message.sticker.file_size;
    fileName = 'sticker.webp';
  } else {
    // Location, contact, etc - always allowed
    return {
      allowed: true,
      mediaType: 'other',
      reason: null
    };
  }

  // Check dangerous files
  if (fileName && isDangerousFile(fileName)) {
    logger.warn('Dangerous file blocked', { 
      fileName, 
      userId: ctx.from?.id,
      mimeType 
    });
    
    return {
      allowed: false,
      mediaType,
      reason: 'dangerous_file',
      fileName,
      severity: 'high'
    };
  }

  // Check suspicious files (warn but allow)
  if (fileName && isSuspiciousFile(fileName)) {
    logger.info('Suspicious file detected', { 
      fileName, 
      userId: ctx.from?.id,
      mimeType 
    });
    
    return {
      allowed: true,
      mediaType,
      reason: 'suspicious_file',
      fileName,
      severity: 'medium',
      warning: true
    };
  }

  // Check file size
  const sizeCheck = checkFileSize(fileSize, mediaType, isPremium);
  if (!sizeCheck.isValid) {
    logger.warn('File size limit exceeded', {
      fileName,
      fileSize,
      maxSize: sizeCheck.maxSize,
      userId: ctx.from?.id,
      isPremium
    });

    return {
      allowed: false,
      mediaType,
      reason: 'file_too_large',
      fileName,
      fileSize: sizeCheck.fileSize,
      maxSize: sizeCheck.maxSize,
      exceedsBy: sizeCheck.exceedsBy,
      severity: 'low'
    };
  }

  // Check MIME type anomalies
  if (mimeType) {
    // Executable disguised as document
    if (mimeType.includes('executable') || mimeType.includes('x-msdownload')) {
      logger.error('Executable file blocked', { 
        fileName, 
        mimeType,
        userId: ctx.from?.id 
      });
      
      return {
        allowed: false,
        mediaType,
        reason: 'executable_file',
        fileName,
        mimeType,
        severity: 'critical'
      };
    }

    // Script files
    if (mimeType.includes('javascript') || 
        mimeType.includes('x-sh') || 
        mimeType.includes('x-python')) {
      logger.error('Script file blocked', { 
        fileName, 
        mimeType,
        userId: ctx.from?.id 
      });
      
      return {
        allowed: false,
        mediaType,
        reason: 'script_file',
        fileName,
        mimeType,
        severity: 'critical'
      };
    }
  }

  // All checks passed
  return {
    allowed: true,
    mediaType,
    reason: null,
    fileName,
    fileSize,
    mimeType
  };
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

async function getBlockMessage(validationResult, language = 'id') {
  const { reason, fileName, fileSize, maxSize, exceedsBy, severity } = validationResult;

  const messages = {
    id: {
      dangerous_file: `🚫 **File Berbahaya Terdeteksi**\n\nFile "${fileName}" tidak dapat dikirim karena terdeteksi sebagai file berbahaya.\n\n⚠️ Jenis file yang diblokir: executable, script, malware\n\nGunakan format file yang aman.`,
      
      executable_file: `🚫 **File Executable Diblokir**\n\nFile "${fileName}" adalah file executable dan tidak diizinkan dikirim.\n\n⛔ File ini berpotensi berbahaya.\n\nSilakan kirim file dengan format lain.`,
      
      script_file: `🚫 **File Script Diblokir**\n\nFile "${fileName}" adalah file script dan tidak diizinkan dikirim.\n\n⛔ File ini berpotensi berbahaya.\n\nSilakan kirim file dengan format lain.`,
      
      file_too_large: `📦 **File Terlalu Besar**\n\nFile "${fileName}" (${formatFileSize(fileSize)}) melebihi batas maksimal ${formatFileSize(maxSize)}.\n\n💡 Solusi:\n• Compress file kamu\n• Upgrade ke Premium untuk limit lebih besar (${formatFileSize(maxFileSizesPremium.document)})\n• Kirim file dengan ukuran lebih kecil`,
      
      suspicious_file: `⚠️ **File Mencurigakan**\n\nFile "${fileName}" terdeteksi sebagai file yang berpotensi mencurigakan.\n\n✅ File tetap dikirim, tapi harap berhati-hati.\n\n💡 Pastikan file ini aman sebelum dibuka.`
    },
    en: {
      dangerous_file: `🚫 **Dangerous File Detected**\n\nFile "${fileName}" cannot be sent because it is detected as a dangerous file.\n\n⚠️ Blocked file types: executable, script, malware\n\nPlease use safe file formats.`,
      
      executable_file: `🚫 **Executable File Blocked**\n\nFile "${fileName}" is an executable file and is not allowed to be sent.\n\n⛔ This file is potentially dangerous.\n\nPlease send a file in another format.`,
      
      script_file: `🚫 **Script File Blocked**\n\nFile "${fileName}" is a script file and is not allowed to be sent.\n\n⛔ This file is potentially dangerous.\n\nPlease send a file in another format.`,
      
      file_too_large: `📦 **File Too Large**\n\nFile "${fileName}" (${formatFileSize(fileSize)}) exceeds maximum limit of ${formatFileSize(maxSize)}.\n\n💡 Solutions:\n• Compress your file\n• Upgrade to Premium for larger limit (${formatFileSize(maxFileSizesPremium.document)})\n• Send a smaller file`,
      
      suspicious_file: `⚠️ **Suspicious File**\n\nFile "${fileName}" is detected as potentially suspicious.\n\n✅ File is sent anyway, but please be careful.\n\n💡 Make sure this file is safe before opening.`
    }
  };

  const langMessages = messages[language] || messages.id;
  return langMessages[reason] || langMessages.dangerous_file;
}

module.exports = {
  validateMedia,
  isDangerousFile,
  isSuspiciousFile,
  checkFileSize,
  getBlockMessage,
  formatFileSize,
  dangerousExtensions,
  suspiciousExtensions,
  maxFileSizes,
  maxFileSizesPremium
};
