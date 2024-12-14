import { $, Context, Schema } from 'koishi'
import { showDeltaElo, showElo } from './utils'

export const name = 'w-elo'

export const inject = [ 'database' ]

export interface Config {
    initialElo: number
    k: number
}

export const Config: Schema<Config> = Schema.object({
    initialElo: Schema
        .number()
        .description('Initial ELO value')
        .default(400),
    k: Schema
        .number()
        .description('K factor')
        .default(32),
})

export interface Elo {
    uid: string
    name: string
    elo: number
}

const enum EloStatus {
    Lose = 0,
    Win = 1,
}

export interface EloRequest {
    rid: number
    src: string
    dest: string
    status: EloStatus
    srcDeltaElo: number
    destDeltaElo: number
}

declare module 'koishi' {
    interface Tables {
        'w-elo': Elo
        'w-elo-request': EloRequest
    }
}

export function apply(ctx: Context, config: Config) {
    ctx
        .model
        .extend('w-elo', {
            uid: 'string',
            name: 'string',
            elo: 'integer',
        }, {
            primary: 'uid',
        })

    ctx
        .model
        .extend('w-elo-request', {
            rid: 'integer',
            src: 'string',
            dest: 'string',
            status: 'integer',
            srcDeltaElo: 'integer',
            destDeltaElo: 'integer',
        }, {
            primary: 'rid',
            autoInc: true,
        })        

    ctx
        .i18n
        .define('zh-CN', require('./locales/zh-CN.yml'))

    ctx
        .command('elo.register <name:string>')
        .action(async ({ session }, name) => {
            if (! (name = name.trim())) return session.text('elo-register-invalid-name')

            const [ self ] = await ctx.database.get('w-elo', session.uid)
            if (self) return session.text('elo-register-duplicate', { name: self.name })

            const { initialElo } = config
            await ctx.database.create('w-elo', { uid: session.uid, name, elo: initialElo })
            return session.text('elo-register-ok', { name, elo: initialElo })
        })

    ctx
        .command('elo.check [user:user]')
        .action(async ({ session }, userId) => {
            const [ user ] = await ctx.database.get('w-elo', userId || session.uid)
            if (! user) return userId
                ? session.text('elo-user-not-found', { uid: userId })
                : session.text('elo-need-register')

            const { name, elo } = user
            return session.text('elo-check', { name, elo: showElo(elo) })
        })

    ctx
        .command('elo.update <user:user>')
        .option('win', '-w', { value: true })
        .option('win', '-l, --lose', { value: false })
        .action(async ({ session, options }, oppoId) => {
            const selfId = session.uid

            const [ [ self ], [ oppo ] ] = await Promise.all([
                ctx.database.get('w-elo', selfId),
                ctx.database.get('w-elo', oppoId),
            ])

            if (! self) return session.text('elo-need-register')
            if (! oppo) return session.text('elo-user-not-found', { uid: oppoId }) 

            const selfName = self.name
            const oppoName = oppo.name

            const [ req ] = await ctx.database.get('w-elo-request', {
                src: oppoId,
                dest: selfId,
            })
            if (req) {
                const { destDeltaElo: selfDeltaElo, srcDeltaElo: oppoDeltaElo, status } = req
                const selfNewElo = self.elo + selfDeltaElo
                const oppoNewElo = oppo.elo + oppoDeltaElo
                Promise.all([
                    ctx.database.set('w-elo', selfId, { elo: selfNewElo }),
                    ctx.database.set('w-elo', oppoId, { elo: oppoNewElo })
                ])
                    .then(() => ctx.database.remove('w-elo-request', req.rid))
                    .catch(err => ctx.logger.error('Update ELO error: %o', err))
                return session.text('elo-update-accept-ok', {
                    selfName,
                    oppoName,
                    selfNewElo: showElo(selfNewElo),
                    selfDeltaElo: showDeltaElo(selfDeltaElo),
                    oppoNewElo: showElo(oppoNewElo),
                    oppoDeltaElo: showDeltaElo(oppoDeltaElo),
                    status: session.text(`elo-status.${ 1 - status }`),
                })
            }
            else {
                const [ req ] = await ctx.database.get('w-elo-request', {
                    src: selfId,
                    dest: oppoId,
                })
                if (req) return session.text('elo-update-request-duplicate', {
                    selfName,
                    oppoName,
                })

                const [
                    [{ elo: selfElo }],
                    [{ elo: oppoElo }],
                ] = await Promise.all([
                    ctx.database.get('w-elo', selfId),
                    ctx.database.get('w-elo', oppoId),
                ])
                const diffElo = oppoElo - selfElo
                const selfE = 1 / (1 + 10 ** (diffElo / config.initialElo))
                const oppoE = 1 / (1 + 10 ** (- diffElo / config.initialElo))
                const status = options.win ? EloStatus.Win : EloStatus.Lose
                const selfDeltaElo = config.k * (status - selfE)
                const oppoDeltaElo = config.k * (1 - status - oppoE)

                ctx.database.create('w-elo-request', {
                    src: selfId,
                    dest: oppoId,
                    status,
                    srcDeltaElo: selfDeltaElo,
                    destDeltaElo: oppoDeltaElo,
                })
                    .catch(err => ctx.logger.error('Create ELO request error: %o', err))

                return session.text('elo-update-request-ok', {
                    selfName: self.name,
                    oppoName: oppo.name,
                    status: session.text(`elo-status.${ status }`),
                })
            }
        })
}
