# Shared AudioMass Vendor Plan

## Goal

Use one customized Dance Station AudioMass codebase in both:

- local Dance Station at `D:\autotransition`
- the Faceless Dancer site at `D:\faceless-dancer-site`

Avoid maintaining two diverging copies.

## Decision

Create a separate GitHub repo for the customized AudioMass bundle, then include it in both repos as a git submodule.

Recommended repo name:

```text
dance-station-audiomass
```

Recommended local paths:

```text
D:\autotransition\src\autotransition\vendor\audiomass
D:\faceless-dancer-site\client\public\dance-station\audiomass
```

## Why Submodule

- One canonical source of truth.
- Both parent repos pin the exact AudioMass commit they use.
- Updates are explicit and reviewable.
- The Python/local app and Preact/site app can consume the same static app without adding an npm/package build step.

## New Repo Contents

Seed the new repo from the current customized local app copy:

```text
D:\autotransition\src\autotransition\vendor\audiomass
```

Add adapter files inside the AudioMass repo:

```text
adapters/
  dance-station-local.js
  dance-station-site.js
```

The adapter layer should handle:

- `ds_audio` and `ds_name` query parameters
- `postMessage` events:
  - `dance-station:audiomass-ready`
  - `dance-station:audiomass-loaded`
  - `dance-station:audiomass-exported`
  - `dance-station:audiomass-error`
- local mode file handoff
- site mode browser blob/CDN URL handoff
- future feature gating for menus/tools/export behavior

## Migration Steps

### 1. Create AudioMass Repo

Create `dance-station-audiomass` on GitHub under the project organization/account.

From a temporary local directory:

```powershell
git init
Copy-Item -Recurse D:\autotransition\src\autotransition\vendor\audiomass\* .
git add .
git commit -m "Seed Dance Station AudioMass"
git branch -M main
git remote add origin <NEW_AUDIOMASS_REPO_URL>
git push -u origin main
```

### 2. Replace Local Dance Station Vendor Folder

In `D:\autotransition`:

```powershell
git rm -r src/autotransition/vendor/audiomass
git submodule add <NEW_AUDIOMASS_REPO_URL> src/autotransition/vendor/audiomass
git add .gitmodules src/autotransition/vendor/audiomass
git commit -m "Use shared AudioMass submodule"
```

### 3. Add Site Submodule

In `D:\faceless-dancer-site`:

```powershell
git submodule add <NEW_AUDIOMASS_REPO_URL> client/public/dance-station/audiomass
git add .gitmodules client/public/dance-station/audiomass
git commit -m "Add shared AudioMass submodule"
```

### 4. Update Setup Docs

Both repos should document:

```powershell
git submodule update --init --recursive
```

Dance Station setup should also run this automatically where practical.

### 5. Wire Site Audio Edit

Update the site Audio Edit iframe to:

```text
/dance-station/audiomass/
```

Use query parameters for selected private/public audio:

```text
/dance-station/audiomass/?ds_mode=site&ds_audio=<url>&ds_name=<name>
```

## Risks

- Existing clones need submodule initialization.
- GitHub must host the new AudioMass repo before parent repos can add the submodule cleanly.
- Submodule commits need to be bumped intentionally in both parent repos when AudioMass changes.

## Success Criteria

- The customized AudioMass source exists once.
- Local Dance Station and the site both reference the same AudioMass commit.
- The site Audio Edit tab embeds the customized AudioMass instance.
- Future AudioMass adapter behavior is changed in one repo and consumed by both parent apps.
