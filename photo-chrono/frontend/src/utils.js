/**
 * Pronoun and name helpers — used throughout the app so UI messages feel personal.
 *
 * subject_sex: 'male' | 'female' | 'unknown'
 */

export function getPronouns(sex) {
  switch (sex) {
    case 'male':
      return { sub: 'he', obj: 'him', pos: 'his', ref: 'himself' }
    case 'female':
      return { sub: 'she', obj: 'her', pos: 'her', ref: 'herself' }
    default:
      return { sub: 'they', obj: 'them', pos: 'their', ref: 'themselves' }
  }
}

/**
 * Returns a sentence that uses the subject's name + correct pronoun.
 * e.g. hintLabel(session, 'older') → "Ed looks older than you think here"
 */
export function hintLabel(session, direction) {
  const name = session?.subject_name || 'the subject'
  switch (direction) {
    case 'older':   return `${name} looks older than you think here`
    case 'younger': return `${name} looks younger than you think here`
    case 'confident': return `I'm confident this is ${name}`
    default: return ''
  }
}

/**
 * Generates the hint placeholder using name.
 * e.g. "I think Ed is older here..."
 */
export function hintPlaceholder(session) {
  const name = session?.subject_name || 'the subject'
  return `e.g. "I think ${name} looks older here" or "${name} seems younger than the AI thinks"`
}

/**
 * Returns a label like "He was born in 1967" or "She was born in 1967"
 */
export function bornLabel(session) {
  const p = getPronouns(session?.subject_sex)
  const cap = p.sub.charAt(0).toUpperCase() + p.sub.slice(1)
  return `${cap} was born in ${session?.birth_year || '?'}`
}
