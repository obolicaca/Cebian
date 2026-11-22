---
name: find-skills
description: >
  Discover reusable skills for a task and help the user install them in Cebian.
  Use when the user asks to find a skill, asks whether a skill exists for a
  specialized job, or wants to extend the assistant's capabilities.
compatibility: >
  Requires Cebian's fs_list, fs_read_file, web_search, and read_page tools.
  Installation of external packages uses the Skills settings import flow.
metadata:
  author: Cebian contributors
  version: "1.0.0"
---

# Find Skills for Cebian

This is a browser-compatible adaptation of the Codex `find-skills` workflow.
Do not suggest running `npx skills` inside Cebian: the extension cannot run a
terminal or install packages into the host operating system.

## Workflow

1. Clarify the user's job from the conversation: domain, desired result, and
   constraints. Ask only for information that cannot be inferred.
2. Call `fs_list` on `~/.cebian/skills/` and read likely matching installed
   `SKILL.md` files. If an installed skill already fits, recommend using it
   directly; do not suggest another download by default.
3. If nothing installed fits, use `web_search` to locate candidate skills.
   Open the source pages with `read_page` and verify each candidate's real
   repository, `SKILL.md`, license, dependencies, and browser compatibility.
   Search results alone are not evidence that a skill is useful or safe.
4. Compare a small number of candidates against the user's task. Mention
   which parts can run with Cebian's tools and which require a terminal,
   Python, Node.js, local files, or another agent platform. Do not present an
   incompatible skill as directly runnable in Cebian.
5. Give the user the source link and a concise reason for each recommendation.
   To install a compatible package, direct them to Cebian Settings → Skills →
   Import Skill. If only source files are available, explain what must be
   adapted before importing. Ask for approval before copying third-party
   instructions or scripts into the user's Skill directory.
6. After an import, list `~/.cebian/skills/` again and read the installed
   `SKILL.md` to verify it appears. Tell the user the exact `/skill-name`
   command they can select in the chat input.

## If no suitable skill exists

Say so plainly. Offer to do the task with Cebian's current tools or use the
installed `skill-creator` to build a browser-compatible Skill.
