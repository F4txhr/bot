const assert = require('assert');
const { validateUserId, validateText, getTrustLevel, normalizeDiscountCode } = require('../src/utils');
const config = require('../src/config');

describe('Bot Core Tests', function() {
  
  describe('Config Module', function() {
    it('should load BOT_TOKEN from environment', function() {
      assert.ok(config.BOT_TOKEN, 'BOT_TOKEN should be defined');
      assert.strictEqual(typeof config.BOT_TOKEN, 'string');
    });

    it('should load SUPABASE_URL from environment', function() {
      assert.ok(config.SUPABASE_URL, 'SUPABASE_URL should be defined');
      assert.strictEqual(typeof config.SUPABASE_URL, 'string');
      assert.ok(config.SUPABASE_URL.startsWith('https://'), 'SUPABASE_URL should start with https://');
    });

    it('should load SUPABASE_KEY from environment', function() {
      assert.ok(config.SUPABASE_KEY, 'SUPABASE_KEY should be defined');
      assert.strictEqual(typeof config.SUPABASE_KEY, 'string');
    });

    it('should parse ADMIN_USER_IDS as array of integers', function() {
      assert.ok(Array.isArray(config.ADMIN_USER_IDS), 'ADMIN_USER_IDS should be an array');
      config.ADMIN_USER_IDS.forEach(id => {
        assert.strictEqual(typeof id, 'number', 'Each admin ID should be a number');
        assert.ok(id > 0, 'Admin ID should be positive');
      });
    });

    it('should have valid WEBHOOK_PORT', function() {
      assert.ok(config.WEBHOOK_PORT, 'WEBHOOK_PORT should be defined');
      const port = parseInt(config.WEBHOOK_PORT);
      assert.ok(port > 0 && port <= 65535, 'WEBHOOK_PORT should be between 1 and 65535');
    });
  });

  describe('Utils Module - Validation', function() {
    it('should validate valid user IDs', function() {
      assert.strictEqual(validateUserId(123456), true);
      assert.strictEqual(validateUserId(1), true);
      assert.strictEqual(validateUserId(999999999), true);
    });

    it('should reject invalid user IDs', function() {
      assert.strictEqual(validateUserId(0), false);
      assert.strictEqual(validateUserId(-1), false);
      assert.strictEqual(validateUserId(null), false);
      assert.strictEqual(validateUserId(undefined), false);
      assert.strictEqual(validateUserId('123'), false);
      assert.strictEqual(validateUserId({}), false);
    });

    it('should validate valid text', function() {
      assert.strictEqual(validateText('Hello'), true);
      assert.strictEqual(validateText('a'), true);
      assert.strictEqual(validateText('This is a valid message'), true);
    });

    it('should reject invalid text', function() {
      assert.strictEqual(validateText(''), false);
      assert.strictEqual(validateText(null), false);
      assert.strictEqual(validateText(undefined), false);
      assert.strictEqual(validateText(123), false);
    });

    it('should reject text exceeding max length', function() {
      const longText = 'a'.repeat(5000);
      assert.strictEqual(validateText(longText), false);
      assert.strictEqual(validateText(longText, 10000), true);
    });
  });

  describe('Utils Module - Trust System', function() {
    it('should return trust level for different scores', function() {
      assert.strictEqual(getTrustLevel(123456), 'normal');
    });

    it('should normalize discount codes correctly', function() {
      assert.strictEqual(normalizeDiscountCode('TEST123'), 'TEST123');
      assert.strictEqual(normalizeDiscountCode('test123'), 'TEST123');
      assert.strictEqual(normalizeDiscountCode('test-123'), 'TEST123');
      assert.strictEqual(normalizeDiscountCode('test_123'), 'TEST123');
      assert.strictEqual(normalizeDiscountCode('test 123'), 'TEST123');
      assert.strictEqual(normalizeDiscountCode(''), '');
      assert.strictEqual(normalizeDiscountCode(null), '');
    });
  });

  describe('Database Module', function() {
    it('should export required functions', function() {
      const db = require('../src/database');
      
      assert.ok(typeof db.initDb === 'function', 'initDb should be a function');
      assert.ok(typeof db.getPartner === 'function', 'getPartner should be a function');
      assert.ok(typeof db.setPair === 'function', 'setPair should be a function');
      assert.ok(typeof db.clearPair === 'function', 'clearPair should be a function');
      assert.ok(typeof db.pushToQueue === 'function', 'pushToQueue should be a function');
      assert.ok(typeof db.popFromQueueExcept === 'function', 'popFromQueueExcept should be a function');
      assert.ok(typeof db.removeFromQueue === 'function', 'removeFromQueue should be a function');
      assert.ok(typeof db.isBanned === 'function', 'isBanned should be a function');
      assert.ok(typeof db.banUser === 'function', 'banUser should be a function');
      assert.ok(typeof db.unbanUser === 'function', 'unbanUser should be a function');
      assert.ok(typeof db.getUserLang === 'function', 'getUserLang should be a function');
      assert.ok(typeof db.setUserLang === 'function', 'setUserLang should be a function');
      assert.ok(typeof db.isPremium === 'function', 'isPremium should be a function');
      assert.ok(typeof db.setPremium === 'function', 'setPremium should be a function');
      assert.ok(typeof db.getUserGender === 'function', 'getUserGender should be a function');
      assert.ok(typeof db.setUserGender === 'function', 'setUserGender should be a function');
      assert.ok(typeof db.getUserSearchGender === 'function', 'getUserSearchGender should be a function');
      assert.ok(typeof db.setUserSearchGender === 'function', 'setUserSearchGender should be a function');
    });
  });

  describe('Bot Module', function() {
    it('should export bot and runBot', function() {
      const botModule = require('../src/bot');
      
      assert.ok(botModule.bot, 'bot should be exported');
      assert.ok(typeof botModule.runBot === 'function', 'runBot should be a function');
    });

    it('should have bot instance with required methods', function() {
      const { bot } = require('../src/bot');
      
      assert.ok(typeof bot.command === 'function', 'bot.command should be a function');
      assert.ok(typeof bot.on === 'function', 'bot.on should be a function');
      assert.ok(typeof bot.start === 'function', 'bot.start should be a function');
      assert.ok(typeof bot.api === 'object', 'bot.api should be an object');
    });
  });

  describe('Commands Module', function() {
    it('should export all required command handlers', function() {
      const commands = require('../src/bot/commands');
      
      assert.ok(typeof commands.handleStart === 'function', 'handleStart should be a function');
      assert.ok(typeof commands.handleFind === 'function', 'handleFind should be a function');
      assert.ok(typeof commands.handleLeave === 'function', 'handleLeave should be a function');
      assert.ok(typeof commands.handleDisconnect === 'function', 'handleDisconnect should be a function');
      assert.ok(typeof commands.handleHelp === 'function', 'handleHelp should be a function');
      assert.ok(typeof commands.handleLang === 'function', 'handleLang should be a function');
      assert.ok(typeof commands.handleReport === 'function', 'handleReport should be a function');
      assert.ok(typeof commands.handleBroadcast === 'function', 'handleBroadcast should be a function');
      assert.ok(typeof commands.handleGiftPremium === 'function', 'handleGiftPremium should be a function');
      assert.ok(typeof commands.handlePremium === 'function', 'handlePremium should be a function');
      assert.ok(typeof commands.handleSearchGender === 'function', 'handleSearchGender should be a function');
      assert.ok(typeof commands.handleSetGender === 'function', 'handleSetGender should be a function');
      assert.ok(typeof commands.handleDiscount === 'function', 'handleDiscount should be a function');
      assert.ok(typeof commands.handleNext === 'function', 'handleNext should be a function');
      assert.ok(typeof commands.getMessage === 'function', 'getMessage should be a function');
      assert.ok(commands.actionKeyboard !== undefined, 'actionKeyboard should be exported');
    });
  });

  describe('Handlers Module', function() {
    it('should export all required handlers', function() {
      const handlers = require('../src/bot/handlers');
      
      assert.ok(typeof handlers.handleCallbackQuery === 'function', 'handleCallbackQuery should be a function');
      assert.ok(typeof handlers.handleMessage === 'function', 'handleMessage should be a function');
      assert.ok(typeof handlers.handleUnknownCommand === 'function', 'handleUnknownCommand should be a function');
    });
  });

  describe('Module Loading', function() {
    it('should load all modules without errors', function() {
      assert.doesNotThrow(() => {
        require('../src/config');
        require('../src/utils');
        require('../src/database');
        require('../src/bot/commands');
        require('../src/bot/handlers');
        require('../src/bot');
      }, 'All modules should load without errors');
    });

    it('should not have circular dependency issues', function() {
      assert.doesNotThrow(() => {
        delete require.cache[require.resolve('../src/bot/commands')];
        delete require.cache[require.resolve('../src/bot/handlers')];
        require('../src/bot/commands');
        require('../src/bot/handlers');
      }, 'Circular dependencies should not cause errors');
    });
  });

  describe('Integration Test', function() {
    it('should initialize bot without errors', function(done) {
      this.timeout(10000);
      
      const { bot } = require('../src/bot');
      
      assert.ok(bot, 'Bot instance should exist');
      done();
    });
  });
});
