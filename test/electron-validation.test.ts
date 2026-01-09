import { describe, it, expect } from 'vitest';
import { isValidExternalUrl, validateDialogOptions } from '../electron/validation';

describe('Electron Validation Functions', () => {
  describe('isValidExternalUrl', () => {
    describe('Production mode (isDev = false)', () => {
      it('should allow valid https URLs', () => {
        expect(isValidExternalUrl('https://example.com', false)).toBe(true);
        expect(isValidExternalUrl('https://github.com/user/repo', false)).toBe(true);
        expect(isValidExternalUrl('https://example.com:8080/path?query=value', false)).toBe(true);
      });

      it('should allow valid http URLs', () => {
        expect(isValidExternalUrl('http://example.com', false)).toBe(true);
        expect(isValidExternalUrl('http://api.example.com/endpoint', false)).toBe(true);
      });

      it('should reject file:// URLs', () => {
        expect(isValidExternalUrl('file:///etc/passwd', false)).toBe(false);
        expect(isValidExternalUrl('file://C:/Windows/System32', false)).toBe(false);
      });

      it('should reject javascript: URLs', () => {
        expect(isValidExternalUrl('javascript:alert(1)', false)).toBe(false);
      });

      it('should reject data: URLs', () => {
        expect(isValidExternalUrl('data:text/html,<script>alert(1)</script>', false)).toBe(false);
      });

      it('should reject localhost URLs in production', () => {
        expect(isValidExternalUrl('http://localhost:3000', false)).toBe(false);
        expect(isValidExternalUrl('http://127.0.0.1:8080', false)).toBe(false);
        expect(isValidExternalUrl('https://localhost', false)).toBe(false);
      });

      it('should reject invalid URLs', () => {
        expect(isValidExternalUrl('not a url', false)).toBe(false);
        expect(isValidExternalUrl('', false)).toBe(false);
        expect(isValidExternalUrl('htp://typo.com', false)).toBe(false);
      });

      it('should reject other dangerous protocols', () => {
        expect(isValidExternalUrl('ftp://example.com', false)).toBe(false);
        expect(isValidExternalUrl('tel:+1234567890', false)).toBe(false);
        expect(isValidExternalUrl('mailto:user@example.com', false)).toBe(false);
      });
    });

    describe('Development mode (isDev = true)', () => {
      it('should allow localhost URLs in dev mode', () => {
        expect(isValidExternalUrl('http://localhost:3000', true)).toBe(true);
        expect(isValidExternalUrl('http://127.0.0.1:8080', true)).toBe(true);
        expect(isValidExternalUrl('https://localhost', true)).toBe(true);
      });

      it('should still reject file:// URLs in dev mode', () => {
        expect(isValidExternalUrl('file:///etc/passwd', true)).toBe(false);
      });

      it('should still reject javascript: URLs in dev mode', () => {
        expect(isValidExternalUrl('javascript:alert(1)', true)).toBe(false);
      });
    });
  });

  describe('validateDialogOptions', () => {
    describe('Message Box validation', () => {
      it('should sanitize valid message box options', () => {
        const input = {
          message: 'Test message',
          title: 'Test title',
          detail: 'Test detail',
          type: 'info',
          buttons: ['OK', 'Cancel']
        };
        const result = validateDialogOptions(input, 'messageBox');
        expect(result).toEqual({
          message: 'Test message',
          title: 'Test title',
          detail: 'Test detail',
          type: 'info',
          buttons: ['OK', 'Cancel']
        });
      });

      it('should truncate long messages', () => {
        const longMessage = 'a'.repeat(2000);
        const result = validateDialogOptions({ message: longMessage }, 'messageBox');
        expect(result.message).toHaveLength(1000);
      });

      it('should truncate long titles', () => {
        const longTitle = 'a'.repeat(500);
        const result = validateDialogOptions({ title: longTitle }, 'messageBox');
        expect(result.title).toHaveLength(200);
      });

      it('should truncate long details', () => {
        const longDetail = 'a'.repeat(5000);
        const result = validateDialogOptions({ detail: longDetail }, 'messageBox');
        expect(result.detail).toHaveLength(2000);
      });

      it('should only allow valid dialog types', () => {
        expect(validateDialogOptions({ type: 'info' }, 'messageBox').type).toBe('info');
        expect(validateDialogOptions({ type: 'error' }, 'messageBox').type).toBe('error');
        expect(validateDialogOptions({ type: 'warning' }, 'messageBox').type).toBe('warning');
        expect(validateDialogOptions({ type: 'question' }, 'messageBox').type).toBe('question');
        expect(validateDialogOptions({ type: 'none' }, 'messageBox').type).toBe('none');
        expect(validateDialogOptions({ type: 'invalid' }, 'messageBox').type).toBeUndefined();
      });

      it('should limit buttons to 4 and truncate labels', () => {
        const buttons = ['Button 1', 'Button 2', 'Button 3', 'Button 4', 'Button 5'];
        const result = validateDialogOptions({ buttons }, 'messageBox');
        expect(result.buttons).toHaveLength(4);
      });

      it('should truncate long button labels', () => {
        const longButton = 'a'.repeat(100);
        const result = validateDialogOptions({ buttons: [longButton] }, 'messageBox');
        expect(result.buttons[0]).toHaveLength(50);
      });

      it('should filter out non-string buttons', () => {
        const buttons = ['Valid', 123, null, 'Also Valid', undefined];
        const result = validateDialogOptions({ buttons }, 'messageBox');
        expect(result.buttons).toEqual(['Valid', 'Also Valid']);
      });

      it('should handle null or undefined options', () => {
        expect(validateDialogOptions(null, 'messageBox')).toEqual({});
        expect(validateDialogOptions(undefined, 'messageBox')).toEqual({});
      });

      it('should ignore non-object options', () => {
        expect(validateDialogOptions('string', 'messageBox')).toEqual({});
        expect(validateDialogOptions(123, 'messageBox')).toEqual({});
      });
    });

    describe('Open Dialog validation', () => {
      it('should sanitize valid open dialog options', () => {
        const input = {
          title: 'Select File',
          defaultPath: '/home/user',
          buttonLabel: 'Select',
          properties: ['openFile', 'multiSelections']
        };
        const result = validateDialogOptions(input, 'openDialog');
        expect(result).toEqual({
          title: 'Select File',
          defaultPath: '/home/user',
          buttonLabel: 'Select',
          properties: ['openFile', 'multiSelections']
        });
      });

      it('should truncate long titles', () => {
        const longTitle = 'a'.repeat(500);
        const result = validateDialogOptions({ title: longTitle }, 'openDialog');
        expect(result.title).toHaveLength(200);
      });

      it('should allow defaultPath as-is', () => {
        const path = '/very/long/path/that/should/not/be/truncated';
        const result = validateDialogOptions({ defaultPath: path }, 'openDialog');
        expect(result.defaultPath).toBe(path);
      });

      it('should truncate long button labels', () => {
        const longLabel = 'a'.repeat(100);
        const result = validateDialogOptions({ buttonLabel: longLabel }, 'openDialog');
        expect(result.buttonLabel).toHaveLength(50);
      });

      it('should filter invalid properties', () => {
        const properties = ['openFile', 'invalidProp', 'openDirectory', 'alsoInvalid'];
        const result = validateDialogOptions({ properties }, 'openDialog');
        expect(result.properties).toEqual(['openFile', 'openDirectory']);
      });

      it('should accept all valid properties', () => {
        const validProps = [
          'openFile', 'openDirectory', 'multiSelections', 'showHiddenFiles',
          'createDirectory', 'promptToCreate', 'noResolveAliases', 'treatPackageAsDirectory'
        ];
        const result = validateDialogOptions({ properties: validProps }, 'openDialog');
        expect(result.properties).toEqual(validProps);
      });

      it('should handle null or undefined options', () => {
        expect(validateDialogOptions(null, 'openDialog')).toEqual({});
        expect(validateDialogOptions(undefined, 'openDialog')).toEqual({});
      });
    });
  });
});
