const { createLogger, validateText } = require('../utils');
const { banUser, addReport } = require('../database');

const logger = createLogger('Moderation');

const toxicPatterns = {
  id: [
    /\b(anjing|babi|kontol|memek|ngentot|jancok|bangsat|pelacur|lonte|perek|jablay|sundel)\b/gi,
    /\b(jembut|kimak|bajingan|kenthu|esu|entot|coli|colmek|bokep|peler|itil|pantek)\b/gi,
    /\b(ngewe|cukimai|cukimay|jembud|tempik|bencong|banci|bispak|waria|bejad)\b/gi,
    /\b(sampah|bangke|pecun|germo|mucikari|gigolo|psk|ayam kampus|kunyuk|bejat)\b/gi,
    /\b(ngaceng|sange|onani|remes|pepek|toket|tetek|pentil|mesum|cabul|selingkuh)\b/gi,
    /\b(perkosa|pemerkosa|pedofil|incest|inses|pervert|sodomi|hombreng|kacung|budak)\b/gi,
  ],
  en: [
    /\b(fuck|motherfucker|motherfucking|fucking|fucker|fuckboy|fuckface|fuckhead)\b/gi,
    /\b(shit|bullshit|shithead|shitface|dipshit|asshole|arsehole|bastard)\b/gi,
    /\b(bitch|bitching|cunt|pussy|cock|dick|penis|vagina|whore|slut|prostitute)\b/gi,
    /\b(rape|rapist|molest|pedophile|pedo|incest|pervert|perv|masturbate|jerk off)\b/gi,
    /\b(nigger|nigga|faggot|fag|retard|retarded|cocksucker|cumslut|cumdumpster)\b/gi,
    /\b(wanker|tosser|bollocks|twat|prick|bellend|knobhead|dickhead|shitbag)\b/gi,
  ]
};

const spamPatterns = [
  /(.)\1{10,}/g,
  /https?:\/\/[^\s]+/gi,
  /t\.me\/[^\s]+/gi,
  /wa\.me\/[^\s]+/gi,
  /@[a-zA-Z0-9_]{5,}/gi,
  /\b\d{10,}\b/g,
];

const scamKeywords = [
  /\b(gratis|free|bonus|hadiah|promo|murah|diskon|cashback)\b/gi,
  /\b(transfer|pulsa|saldo|dana|ovo|gopay|shopee)\b/gi,
  /\b(klik|link|daftar|register|login|password|pin)\b/gi,
];

function detectToxicContent(text, language = 'id') {
  if (!validateText(text)) {
    return { isToxic: false, confidence: 0, matches: [] };
  }

  const patterns = language === 'en' ? toxicPatterns.en : toxicPatterns.id;
  const matches = [];
  let totalMatches = 0;

  for (const pattern of patterns) {
    const found = text.match(pattern);
    if (found) {
      matches.push(...found);
      totalMatches += found.length;
    }
  }

  const wordCount = text.split(/\s+/).length;
  const toxicRatio = wordCount > 0 ? totalMatches / wordCount : 0;
  const confidence = Math.min(toxicRatio * 100, 100);

  return {
    isToxic: confidence > 30,
    confidence: confidence.toFixed(2),
    matches: [...new Set(matches)],
    severity: confidence > 70 ? 'high' : confidence > 40 ? 'medium' : 'low'
  };
}

function detectSpam(text) {
  if (!validateText(text)) {
    return { isSpam: false, confidence: 0, patterns: [] };
  }

  const detectedPatterns = [];
  let score = 0;

  for (const pattern of spamPatterns) {
    if (pattern.test(text)) {
      detectedPatterns.push(pattern.toString());
      score += 20;
    }
  }

  const upperCaseRatio = (text.match(/[A-Z]/g) || []).length / text.length;
  if (upperCaseRatio > 0.7 && text.length > 10) {
    score += 30;
    detectedPatterns.push('excessive_caps');
  }

  if (text.length > 500) {
    score += 15;
    detectedPatterns.push('long_message');
  }

  const confidence = Math.min(score, 100);

  return {
    isSpam: confidence > 50,
    confidence: confidence.toFixed(2),
    patterns: detectedPatterns,
    severity: confidence > 80 ? 'high' : confidence > 60 ? 'medium' : 'low'
  };
}

function detectScam(text) {
  if (!validateText(text)) {
    return { isScam: false, confidence: 0, keywords: [] };
  }

  const detectedKeywords = [];
  let matchCount = 0;

  for (const pattern of scamKeywords) {
    const matches = text.match(pattern);
    if (matches) {
      detectedKeywords.push(...matches);
      matchCount += matches.length;
    }
  }

  const hasUrl = /https?:\/\/[^\s]+/.test(text) || /t\.me\/[^\s]+/.test(text);
  const hasPhoneNumber = /\b\d{10,}\b/.test(text);

  let score = matchCount * 15;
  if (hasUrl) score += 25;
  if (hasPhoneNumber) score += 20;
  if (matchCount >= 3) score += 30;

  const confidence = Math.min(score, 100);

  return {
    isScam: confidence > 60,
    confidence: confidence.toFixed(2),
    keywords: [...new Set(detectedKeywords)],
    severity: confidence > 80 ? 'high' : confidence > 60 ? 'medium' : 'low',
    hasUrl,
    hasPhoneNumber
  };
}

async function moderateMessage(text, userId, language = 'id') {
  const toxic = detectToxicContent(text, language);
  const spam = detectSpam(text);
  const scam = detectScam(text);

  const moderationResult = {
    toxic,
    spam,
    scam,
    shouldBlock: false,
    shouldWarn: false,
    shouldAutoBan: false,
    action: 'allow',
    reason: null
  };

  if (toxic.isToxic && toxic.severity === 'high') {
    moderationResult.shouldBlock = true;
    moderationResult.action = 'block';
    moderationResult.reason = 'toxic_content';
    
    await addReport(userId, 0, `Auto-moderation: Toxic content detected (${toxic.confidence}% confidence)`);
    logger.warn('Toxic content blocked', { userId, confidence: toxic.confidence, matches: toxic.matches });
  } else if (scam.isScam && scam.severity === 'high') {
    moderationResult.shouldBlock = true;
    moderationResult.shouldAutoBan = true;
    moderationResult.action = 'ban';
    moderationResult.reason = 'scam_attempt';
    
    await banUser(userId, 'Auto-ban: Scam attempt detected', 7);
    logger.error('Scam attempt detected and user banned', { userId, confidence: scam.confidence });
  } else if (spam.isSpam && spam.severity === 'high') {
    moderationResult.shouldBlock = true;
    moderationResult.action = 'block';
    moderationResult.reason = 'spam';
    
    await addReport(userId, 0, `Auto-moderation: Spam detected (${spam.confidence}% confidence)`);
    logger.warn('Spam blocked', { userId, confidence: spam.confidence });
  } else if (toxic.isToxic || spam.isSpam || scam.isScam) {
    moderationResult.shouldWarn = true;
    moderationResult.action = 'warn';
    moderationResult.reason = toxic.isToxic ? 'mild_toxic' : spam.isSpam ? 'mild_spam' : 'suspicious';
    
    logger.info('Content flagged for review', { userId, toxic, spam, scam });
  }

  return moderationResult;
}

const userMessageHistory = new Map();

function trackMessageFrequency(userId) {
  const now = Date.now();
  const history = userMessageHistory.get(userId) || [];
  
  const recentMessages = history.filter(timestamp => now - timestamp < 60000);
  recentMessages.push(now);
  
  userMessageHistory.set(userId, recentMessages);
  
  return {
    count: recentMessages.length,
    isFlooding: recentMessages.length > 10
  };
}

async function checkFloodControl(userId) {
  const frequency = trackMessageFrequency(userId);
  
  if (frequency.isFlooding) {
    await addReport(userId, 0, `Auto-moderation: Message flooding (${frequency.count} messages/min)`);
    logger.warn('User flooding detected', { userId, count: frequency.count });
    
    return {
      shouldBlock: true,
      shouldTempBan: true,
      reason: 'flooding',
      messageCount: frequency.count
    };
  }
  
  return {
    shouldBlock: false,
    shouldTempBan: false,
    messageCount: frequency.count
  };
}

function cleanupMessageHistory() {
  const now = Date.now();
  for (const [userId, history] of userMessageHistory.entries()) {
    const recentMessages = history.filter(timestamp => now - timestamp < 300000);
    if (recentMessages.length === 0) {
      userMessageHistory.delete(userId);
    } else {
      userMessageHistory.set(userId, recentMessages);
    }
  }
}

setInterval(cleanupMessageHistory, 5 * 60 * 1000);

module.exports = {
  detectToxicContent,
  detectSpam,
  detectScam,
  moderateMessage,
  trackMessageFrequency,
  checkFloodControl
};