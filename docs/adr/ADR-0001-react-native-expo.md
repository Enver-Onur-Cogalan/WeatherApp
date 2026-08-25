# ADR-0001 — React Native with Expo for the mobile client

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

The project needs to demonstrate mobile development skill credibly, on a codebase one
person can maintain. React Native is the author's professional platform, which narrows
the question to bare React Native versus Expo.

The application needs capabilities that were historically arguments *against* Expo:
home-screen widgets, camera access, secure credential storage, and heavy animation.

## Decision

Build the client with **React Native using Expo**, and reach native capability through
config plugins rather than by ejecting.

## Consequences

**Positive**

- One codebase, two platforms, no hand-maintained native projects.
- EAS Build produces installable artifacts from CI without a local toolchain, which
  matters for a project whose readers will want to try it.
- `expo-router`, `expo-secure-store`, `expo-sqlite`, and `expo-camera` cover most of
  what we need without third-party native modules.
- Writing a config plugin for the widget is itself a demonstration of depth — it is the
  part of Expo that separates familiarity from expertise.

**Negative**

- Some native libraries lag Expo SDK releases; we accept being one version behind
  when a dependency has not caught up.
- Streaming HTTP requires `expo/fetch` rather than the standard `fetch`, which is a
  known rough edge (documented in [doc 02](../02-mobile-stack.md)).

## Alternatives considered

| Option | Why not |
|---|---|
| Bare React Native | More control, but two native projects to maintain and no EAS Build path. The control buys nothing we need. |
| Flutter | Excellent for animation, but outside the author's professional stack — it would demonstrate less, not more. |
| Native Swift + Kotlin | Twice the work, and the AI service is where this project's differentiation lives. |
