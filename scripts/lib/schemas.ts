import { z } from 'zod'

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
})
export type Repo = z.infer<typeof RepoSchema>
export const ReposSchema = z.array(RepoSchema)

export const LanguagesSchema = z.record(z.string(), z.number().nonnegative())
export type Languages = z.infer<typeof LanguagesSchema>

// Config files: unknown fields rejected.
export const OverrideSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    // Plain file name only: no path, no "..".
    screenshot: z.string().regex(/^(?!.*\.\.)[A-Za-z0-9._-]+\.(webp|png|jpg)$/).optional(),
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
  homepage: z.string().nullable(),
  repoUrl: z.string(),
  pushedAt: z.string(),
  stars: z.number(),
  screenshot: z.string().nullable(),
  featured: z.boolean(),
  readmeHtml: z.string(),
})
export type Project = z.infer<typeof ProjectSchema>
