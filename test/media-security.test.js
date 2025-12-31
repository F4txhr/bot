const assert = require('assert');
const { 
  isDangerousFile, 
  isSuspiciousFile, 
  checkFileSize, 
  formatFileSize,
  getFileExtension 
} = require('../src/admin/media-security');

describe('Media Security Tests', function() {
  
  describe('File Extension Detection', function() {
    it('should detect dangerous executable files', function() {
      assert.strictEqual(isDangerousFile('malware.exe'), true);
      assert.strictEqual(isDangerousFile('virus.bat'), true);
      assert.strictEqual(isDangerousFile('script.sh'), true);
      assert.strictEqual(isDangerousFile('hack.py'), true);
      assert.strictEqual(isDangerousFile('trojan.apk'), true);
    });

    it('should not flag safe files as dangerous', function() {
      assert.strictEqual(isDangerousFile('photo.jpg'), false);
      assert.strictEqual(isDangerousFile('video.mp4'), false);
      assert.strictEqual(isDangerousFile('audio.mp3'), false);
      assert.strictEqual(isDangerousFile('document.txt'), false);
    });

    it('should detect suspicious office files', function() {
      assert.strictEqual(isSuspiciousFile('document.docx'), true);
      assert.strictEqual(isSuspiciousFile('spreadsheet.xlsx'), true);
      assert.strictEqual(isSuspiciousFile('presentation.pptx'), true);
      assert.strictEqual(isSuspiciousFile('file.pdf'), true);
    });

    it('should handle case insensitive extensions', function() {
      assert.strictEqual(isDangerousFile('MALWARE.EXE'), true);
      assert.strictEqual(isDangerousFile('Script.SH'), true);
      assert.strictEqual(isSuspiciousFile('Document.PDF'), true);
    });

    it('should handle files without extensions', function() {
      assert.strictEqual(isDangerousFile('filename'), false);
      assert.strictEqual(isSuspiciousFile('filename'), false);
    });
  });

  describe('File Size Validation', function() {
    it('should validate file sizes for free users', function() {
      const result = checkFileSize(10 * 1024 * 1024, 'photo', false);
      assert.strictEqual(result.isValid, true);
    });

    it('should reject oversized files for free users', function() {
      const result = checkFileSize(30 * 1024 * 1024, 'photo', false);
      assert.strictEqual(result.isValid, false);
      assert.ok(result.exceedsBy > 0);
    });

    it('should allow larger files for premium users', function() {
      const result = checkFileSize(40 * 1024 * 1024, 'photo', true);
      assert.strictEqual(result.isValid, true);
    });

    it('should reject oversized files even for premium users', function() {
      const result = checkFileSize(60 * 1024 * 1024, 'photo', true);
      assert.strictEqual(result.isValid, false);
    });

    it('should handle different media types', function() {
      const videoResult = checkFileSize(45 * 1024 * 1024, 'video', false);
      assert.strictEqual(videoResult.isValid, true);
      
      const documentResult = checkFileSize(15 * 1024 * 1024, 'document', false);
      assert.strictEqual(documentResult.isValid, true);
    });
  });

  describe('File Size Formatting', function() {
    it('should format bytes correctly', function() {
      assert.strictEqual(formatFileSize(0), '0 B');
      assert.strictEqual(formatFileSize(1024), '1 KB');
      assert.strictEqual(formatFileSize(1024 * 1024), '1 MB');
      assert.strictEqual(formatFileSize(1024 * 1024 * 1024), '1 GB');
    });

    it('should handle decimal values', function() {
      const size = formatFileSize(1536 * 1024);
      assert.ok(size.includes('1.5'));
      assert.ok(size.includes('MB'));
    });
  });

  describe('Security Rules', function() {
    const dangerousFiles = [
      'malware.exe', 'virus.bat', 'script.cmd', 'hack.com',
      'trojan.pif', 'backdoor.scr', 'keylogger.vbs', 'exploit.js',
      'shell.sh', 'payload.ps1', 'rootkit.apk', 'spyware.jar'
    ];

    const suspiciousFiles = [
      'invoice.docx', 'report.xlsx', 'presentation.pptx',
      'contract.pdf', 'resume.doc', 'data.xls'
    ];

    const safeFiles = [
      'photo.jpg', 'image.png', 'video.mp4', 'audio.mp3',
      'song.ogg', 'movie.avi', 'clip.webm', 'picture.gif'
    ];

    it('should block all dangerous file types', function() {
      dangerousFiles.forEach(file => {
        assert.strictEqual(isDangerousFile(file), true, `${file} should be blocked`);
      });
    });

    it('should flag all suspicious file types', function() {
      suspiciousFiles.forEach(file => {
        assert.strictEqual(isSuspiciousFile(file), true, `${file} should be flagged`);
      });
    });

    it('should allow all safe file types', function() {
      safeFiles.forEach(file => {
        assert.strictEqual(isDangerousFile(file), false, `${file} should be allowed`);
        assert.strictEqual(isSuspiciousFile(file), false, `${file} should not be flagged`);
      });
    });
  });
});
