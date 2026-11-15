import { z } from 'zod'

// Plain file name only: no path, no "..".
export const SHOT_FILE = /^(?!.*\.\.)[A-Za-z0-9._-]+\.(webp|png|jpg)$/

export const REPO_NAME = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/

// GitHub API response (unknown fields are stripped; wrong types fail the whole refresh).
export const RepoSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable(),
  topics: z.array(z.string()).default([]),
  language: z.string().nullable(),
  homepage: z.string().nullable(),
  pushed_at: z.iso.datetime(),
  stargazers_count: z.number().int().nonnegative(),
  fork: z.boolean(),
  archived: z.boolean(),
  private: z.boolean(),
  owner: z.object({ login: z.string() }),
  default_branch: z.string().min(1),
})
export type Repo = z.infer<typeof RepoSchema>
export const ReposSchema = z.array(RepoSchema)

export const ReadmeSchema = z.object({ content: z.string(), encoding: z.string(), path: z.string() })

export const LanguagesSchema = z.record(z.string(), z.number().nonnegative())
export type Languages = z.infer<typeof LanguagesSchema>

// Config files: unknown fields rejected.
export const OverrideSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    // Plain file name only: no path, no "..".
    screenshot: z.string().regex(SHOT_FILE).optional(),
  })
  .strict()
export type Override = z.infer<typeof OverrideSchema>

export const SettingsSchema = z
  .object({
    health: z.object({ retries: z.number().int().positive(), timeoutMs: z.number().int().positive() }).strict(),
    shot: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        timeoutMs: z.number().int().positive(),
      })
      .strict(),
  })
  .strict()
export type Settings = z.infer<typeof SettingsSchema>

export const ProjectSchema = z.object({
  name: z.string().regex(REPO_NAME),
  title: z.string(),
  description: z.string(),
  topics: z.array(z.string()),
  language: z.string().nullable(),
  languages: LanguagesSchema,
  homepage: z.url({ protocol: /^https$/ }).nullable(),
  repoUrl: z.url({ protocol: /^https$/ }),
  pushedAt: z.string(),
  stars: z.number(),
  screenshot: z.string().regex(SHOT_FILE).nullable(),
  featured: z.boolean(),
  readmeHtml: z.string(),
})
export type Project = z.infer<typeof ProjectSchema>

// config/site.json: unknown fields rejected. `about` = intro paragraph, then bullets; a bullet written "Label: text" renders with a bold Label.
// linkedinUrl "" means hidden (rule 17).
export const SiteSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().min(1),
    pitch: z.string().min(1),
    about: z.array(z.string().min(1)).min(1),
    linkedinUrl: z.union([z.literal(''), z.url({ protocol: /^https$/ })]),
    skills: z.array(z.string().min(1)),
  })
  .strict()
export type Site = z.infer<typeof SiteSchema>
