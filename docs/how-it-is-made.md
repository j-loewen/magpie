# How Magpie is made

**Magpie is developed with AI.** This page says what that means, so you can decide whether you want to use it.

## Who wrote what

- **Almost all of the code, the automated tests and this documentation were written by an AI coding assistant**, [Claude Code](https://claude.com/claude-code) by Anthropic. Of the first 56 commits in this repository, 55 name Claude as co-author.
- **A human maintainer directs the project**: they decide what Magpie should do, describe features and changes, try the results and decide what goes in.
- Commits written with the assistant say so in a `Co-Authored-By: Claude …` line, so the history shows which changes were made this way.

## What that means for you

- **No independent review.** No professional developer or security expert outside the project has reviewed or audited the code. That includes the parts that protect your data: [encryption](encryption.md), sign-in, sessions, [sharing](user-guide.md#sharing) and [private folders](user-guide.md#private-folders). They use established building blocks (SQLCipher, AES-256-GCM, Argon2 password hashing) and are covered by automated tests, but the tests were written by the same AI.
- **Mistakes are possible** that nobody has noticed yet, as in any software, and AI-written code can be wrong in ways that look convincing.
- **Keep your own [backups](backups.md)**, and think about what you store before putting very sensitive data in it or opening it to people you don't know.

If you would rather not use AI-written software, this is the point to stop. No hard feelings.

## Found a problem?

Please open an issue on GitHub, especially for anything security-related. Reviews of the code by people who know what they're doing are very welcome.
