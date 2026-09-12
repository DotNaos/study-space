---
name: study-course-artwork
description: Generate, replace or reset a Study Space course cover using the agent's image-generation tool/skill and the local artwork API. Use when Oli asks for a course image, not for Moodle administration.
---

# Study Space course artwork

1. Resolve the exact course through Study Space (`study_courses`, `study_course`). Read its topic before choosing a visual metaphor. Use Study Space, not the deprecated Moodle connector.
2. Confirm the requested course and scope from the user's instruction. Do not bulk-replace covers or change Moodle itself.
3. Use the available image-generation tool/skill. Generate a square PNG or WebP: one clear 3D metaphor, quiet background, no lettering or semester text, recognisable at thumbnail size, with crop-safe margins. Reuse or edit user-provided artwork when requested. Do not call Codex or a paid image API merely to generate a cover from a ChatGPT session.
4. Inspect the generated image. Use its actual returned local file path, never an inferred filename. Keep the image at or below 4 MiB. When the image and the uploader run on different hosts, transfer it through an explicitly available file-transfer tool first; never assume their filesystems are shared.
5. Read the target installation's current `study_status.app.publicUrl`. Upload the file through the regular Study Space endpoint using the helper on a host that can reach that installation:

   ```sh
   python3 scripts/course-artwork.py COURSE_ID /actual/generated-image.png --base-url https://STUDY_ORIGIN
   ```

   This sends the image body directly with its raster MIME type. It does not expose credentials, accept arbitrary download URLs, or modify upstream Moodle. The API validates the connected account, enrollment, MIME, file signature and the 4 MiB limit.
6. Confirm the returned `hasCustomImage: true`, then reload the course and visually check the cover. Changing artwork changes `imageVersion`, so the browser does not reuse an obsolete image.
7. Only on an explicit reset request:

   ```sh
   python3 scripts/course-artwork.py COURSE_ID --reset --base-url https://STUDY_ORIGIN
   ```

The web course image opens the same editor: select/upload, replace, reset, or open an editable generation prompt in ChatGPT. The web app does not silently invoke an image model. Its generation handoff is explicit; the resulting image is selected and saved in the editor. A copy-prompt fallback is available when the ChatGPT link does not prefill the composer.
