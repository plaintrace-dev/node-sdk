/** The inline stub sites paste before the script tag. It defines px only when nothing else
    owns the name, and marks itself (s = 1) so the tracker never mistakes another library's px
    for it. Kept here so the README and the tests use the very same text. */
export const SNIPPET = 'if(!window.px){var p=window.px=function(){p.q.push(arguments)};p.q=[];p.s=1}'
