---
name: Invalid_Skill--Name
description: Breaks several Agent Skills rules on purpose.
categories:
  - seo
compatibility: [not, a, string]
disable-model-invocation: true
custom-field: whatever
---

# Deliberately invalid

The frontmatter above has a badly formed `name` that does not match the
directory, a legacy `categories` list, a non-string `compatibility`, a client
extension field and an unknown field. The `description` also never says when
to use the skill.
