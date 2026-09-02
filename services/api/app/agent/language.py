"""Which language a question was asked in.

The app's two languages are equals — neither is a translation layer over the other
(CLAUDE.md) — so the engine's own answers have to exist in both. The model handles this
by being told to match the question; the fallback has no model to tell, and the first
version simply hard-coded Turkish. An English question got a Turkish answer, and the
evaluation suite caught it on its first full run.

Deliberately crude. The only question is "Turkish or English", and Turkish orthography
answers it without a dependency. This detects the **question**; the evaluation suite
detects the **answer**, with its own copy — measuring a rule with the rule it measures
proves nothing.
"""

from __future__ import annotations

from typing import Literal

Language = Literal["tr", "en"]

# Letters that exist in Turkish and not in English. One is enough.
TURKISH_LETTERS = frozenset("çğıöşüÇĞİÖŞÜ")

# Words common enough to decide an unaccented sentence — "bu hafta kosu icin" is still
# Turkish, and people type without diacritics more often than not.
TURKISH_WORDS = frozenset(
    {
        "bu",
        "ne",
        "mi",
        "mu",
        "mı",
        "için",
        "icin",
        "hava",
        "gun",
        "gün",
        "saat",
        "hafta",
        "yarin",
        "yarın",
        "bugun",
        "bugün",
        "olur",
        "nasil",
        "nasıl",
        "zaman",
        "sonu",
        "daha",
        "iyi",
        "kosu",
        "koşu",
    }
)

ENGLISH_WORDS = frozenset(
    {
        "the",
        "is",
        "can",
        "i",
        "when",
        "what",
        "how",
        "best",
        "time",
        "will",
        "should",
        "weather",
        "tomorrow",
        "today",
        "week",
        "run",
        "good",
    }
)


def detect(question: str) -> Language:
    """Turkish unless the words say otherwise.

    Turkish is the default because the app is Turkish-first in its sample content and a
    wrong guess costs the same either way — but an unmistakably English question should
    never get a Turkish answer, which is the failure this exists to prevent.
    """
    if any(letter in question for letter in TURKISH_LETTERS):
        return "tr"

    words = {word for word in question.lower().replace("?", " ").split() if word}
    turkish = len(words & TURKISH_WORDS)
    english = len(words & ENGLISH_WORDS)

    return "en" if english > turkish else "tr"
