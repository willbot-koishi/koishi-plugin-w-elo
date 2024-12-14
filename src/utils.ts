export const showDeltaElo = (deltaElo: number) => {
    const sign = deltaElo > 0 ? '+' : ''
    return `${ sign }${ Math.round(deltaElo) }`
}

export const showElo = (elo: number) => {
    return `${ Math.round(elo) }`
}