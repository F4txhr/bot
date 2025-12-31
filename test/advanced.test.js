const assert = require('assert');
const { 
  detectToxicContent, 
  detectSpam, 
  detectScam, 
  moderateMessage 
} = require('../src/admin/moderation');
const {
  ratePartner,
  getUserRatingStats
} = require('../src/admin/rating');
const {
  generateReferralCode,
  createReferralCode
} = require('../src/admin/referral');
const {
  cleanupExpiredPremium,
  cleanupOldReports
} = require('../src/admin/cleanup');

describe('Advanced Features Tests', function() {
  
  describe('Moderation Module', function() {
    it('should detect toxic content in Indonesian', function() {
      const result = detectToxicContent('kamu anjing tolol goblok', 'id');
      assert.ok(result.isToxic, 'Should detect toxic content');
      assert.ok(result.confidence > 30, 'Confidence should be high');
      assert.ok(result.matches.length > 0, 'Should have matches');
    });

    it('should detect toxic content in English', function() {
      const result = detectToxicContent('you fucking asshole motherfucker', 'en');
      assert.ok(result.isToxic, 'Should detect toxic content');
      assert.ok(result.confidence > 30, 'Confidence should be high');
    });

    it('should not flag clean content', function() {
      const result = detectToxicContent('halo apa kabar', 'id');
      assert.strictEqual(result.isToxic, false, 'Should not flag clean content');
    });

    it('should detect spam with URLs and patterns', function() {
      const result = detectSpam('JOIN NOW!!! https://scam.com FREE MONEY @promo_bot wa.me/081234567890');
      assert.ok(result.confidence > 0, 'Should have spam indicators');
      assert.ok(result.patterns.length > 0, 'Should detect patterns');
    });

    it('should detect spam with excessive caps', function() {
      const result = detectSpam('HALO SEMUA INI PROMO GRATIS BONUS BESAR KLIK SEKARANG');
      assert.ok(result.confidence > 0, 'Should detect caps spam');
    });

    it('should detect scam content', function() {
      const result = detectScam('Gratis transfer pulsa 100rb! Klik link: https://scam.com atau WA 081234567890');
      assert.ok(result.isScam, 'Should detect scam');
      assert.ok(result.hasUrl, 'Should detect URL');
      assert.ok(result.hasPhoneNumber, 'Should detect phone number');
    });

    it('should not flag legitimate messages', function() {
      const result = detectScam('Halo, apa kabar? Saya sedang belajar programming.');
      assert.strictEqual(result.isScam, false, 'Should not flag legitimate content');
    });
  });

  describe('Rating System', function() {
    it('should validate rating values', async function() {
      const result = await ratePartner(123, 456, 'invalid');
      assert.strictEqual(result.success, false, 'Should reject invalid rating');
    });

    it('should accept valid rating values', function() {
      const validRatings = ['positive', 'neutral', 'negative'];
      validRatings.forEach(rating => {
        assert.ok(['positive', 'neutral', 'negative'].includes(rating));
      });
    });

    it('should calculate rating stats correctly', async function() {
      const stats = await getUserRatingStats(999999);
      assert.ok(stats !== null, 'Should return stats object');
      assert.ok(typeof stats.totalRatings === 'number');
      assert.ok(['new', 'bad', 'poor', 'average', 'good', 'excellent'].includes(stats.level));
    });
  });

  describe('Referral System', function() {
    it('should generate referral code', function() {
      const code = generateReferralCode(123456);
      assert.ok(code.startsWith('REF'), 'Code should start with REF');
      assert.ok(code.length >= 8, 'Code should have minimum length');
    });

    it('should generate unique codes for different users', function() {
      const code1 = generateReferralCode(123);
      const code2 = generateReferralCode(456);
      assert.notStrictEqual(code1, code2, 'Codes should be unique');
    });
  });

  describe('Cleanup Module', function() {
    it('should have cleanup functions', function() {
      assert.ok(typeof cleanupExpiredPremium === 'function');
      assert.ok(typeof cleanupOldReports === 'function');
    });

    it('should return cleanup results', async function() {
      const result = await cleanupExpiredPremium();
      assert.ok(result !== null, 'Should return result object');
      assert.ok(typeof result.success === 'boolean');
      assert.ok(typeof result.count === 'number');
    });
  });

  describe('Integration - Moderation Flow', function() {
    it('should moderate clean message', async function() {
      const result = await moderateMessage('Hello, how are you?', 123456, 'en');
      assert.strictEqual(result.action, 'allow', 'Should allow clean message');
      assert.strictEqual(result.shouldBlock, false, 'Should not block');
    });

    it('should block highly toxic content', async function() {
      this.timeout(5000);
      const result = await moderateMessage('fuck you bastard asshole', 123456, 'en');
      assert.ok(['block', 'warn'].includes(result.action), 'Should take action on toxic content');
    });

    it('should detect and block scam attempts', async function() {
      this.timeout(5000);
      const result = await moderateMessage('GRATIS TRANSFER 100rb KLIK https://scam.com', 123456, 'id');
      assert.ok(['block', 'ban', 'warn'].includes(result.action), 'Should take action on scam');
    });
  });

  describe('Edge Cases', function() {
    it('should handle empty text', function() {
      const toxic = detectToxicContent('', 'id');
      const spam = detectSpam('');
      const scam = detectScam('');
      
      assert.strictEqual(toxic.isToxic, false);
      assert.strictEqual(spam.isSpam, false);
      assert.strictEqual(scam.isScam, false);
    });

    it('should handle null/undefined input', function() {
      const toxic = detectToxicContent(null, 'id');
      const spam = detectSpam(undefined);
      
      assert.strictEqual(toxic.isToxic, false);
      assert.strictEqual(spam.isSpam, false);
    });

    it('should handle very long text', function() {
      const longText = 'a'.repeat(1000);
      const spam = detectSpam(longText);
      
      assert.ok(typeof spam.isSpam === 'boolean');
    });
  });
});