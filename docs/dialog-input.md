# Dialog input regression

All application modal forms use the shared Dialog component, including Dashboard Flow and folder creation. It mounts in a body portal, owns a topmost-only focus scope, handles Escape and Tab, and dismisses a backdrop click only when the pointer also started on that backdrop. No delayed refocus loop should be added to individual forms.

Application messages and confirmations use showMessage and await askConfirmation from web/src/lib/app-dialog.ts. Never use synchronous browser alert/confirm/prompt in application code. Confirmation cancellation must leave data unchanged; queued messages must not replace one another. AppDialogHost is mounted once at the application root.

## Verification

- In web: npm run test:dialog, npm run test:rich-text, npm run lint, npm run build:desktop.
- After building web, launch desktop/scripts/verify-dialog-input.cjs with the repository desktop Electron executable, with ELECTRON_RUN_AS_NODE unset.
- The Electron test uses an isolated temporary userData directory and an offscreen renderer. It checks actual mouse input and text insertion into the built application, repeated Flow dialogs, field switching, drag-out versus backdrop click, folder delete cancellation/acceptance, input after confirmation, source creation and channel forms. It makes no provider request and does not use real keys or user data.
- The DOM test checks StrictMode lifecycle, focus containment/restoration, nested confirmation, cancel/accept, message queueing and Escape.

These tests do not prove the historical failure's exact trigger, native OS focus recovery, real IME behavior, or the behavior of an already installed older executable. Manual verification in the updated packaged desktop application remains necessary. Frontend builds alone are not sufficient evidence of a fix.
