const express = require('express')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const path = require('path')
const jsonWebToken = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const app = express()
app.use(express.json())
let db = null
let token
const dbPath = path.join(__dirname, 'twitterClone.db')
module.exports = app

const initializeServerandDb = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => console.log('server started'))
  } catch (error) {
    console.log(`db error:${error.Message}`)
    process.exit(1)
  }
}

initializeServerandDb()

const authenticateToken = (request, response, next) => {
  const authHeader = request.headers['authorization']
  if (authHeader === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    token = authHeader.split(' ')[1]
    if (token === undefined) {
      response.status(401)
      response.send('Invalid JWT Token')
    } else {
      jsonWebToken.verify(token, 'secret_key', async (error, payload) => {
        if (error) {
          response.status(401)
          response.send('Invalid JWT Token')
        } else {
          request.username = payload.username
          next()
        }
      })
    }
  }
}

let userId

const getUserId = async (request, response, next) => {
  const username = request.username
  const getUserIdQuery = `select user_id as userId from user where username='${username}';`
  const userIdDetails = await db.get(getUserIdQuery)
  if (userIdDetails !== undefined) {
    userId = userIdDetails.userId
    next()
  } else {
    response.status(400)
    response.send('Invalid user')
  }
}

//1 register
app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const getUserProfileQuery = `select * from user where username='${username}';`
  const userProfile = await db.get(getUserProfileQuery)
  if (userProfile === undefined) {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const hashedPassword = await bcrypt.hash(password, 5)
      const registerUserQuery = `insert into user(username, password, name, gender)
                                values('${username}','${hashedPassword}','${name}','${gender}');`
      await db.run(registerUserQuery)
      response.status(200)
      response.send('User created successfully')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

//2 login
app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const getUserProfileQuery = `select * from user where username='${username}';`
  const userProfile = await db.get(getUserProfileQuery)
  if (userProfile === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isValidPassword = await bcrypt.compare(password, userProfile.password)
    if (isValidPassword) {
      const payload = {username: username}
      const jwtToken = jsonWebToken.sign(payload, 'secret_key')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

//3 get latest 4 tweets of user
app.get(
  '/user/tweets/feed/',
  authenticateToken,
  getUserId,
  async (request, response) => {
    const followingId = `select user.username, tweet.tweet, tweet.date_time as dateTime
                      from user
                      join tweet 
                      on tweet.user_id=user.user_id
                      join follower on tweet.user_id=follower.following_user_id
                      where follower.follower_user_id=${userId}
                      order by dateTime desc
                      limit 4
                      ;`
    const followingFeed = await db.all(followingId)
    response.send(followingFeed)
  },
)

//4 get following names

app.get(
  '/user/following/',
  authenticateToken,
  getUserId,
  async (request, response) => {
    const followingId = `select user.name
                      from user
                      join follower 
                      on user.user_id=follower.following_user_id
                      where follower.follower_user_id=${userId};`
    const followingFeed = await db.all(followingId)
    response.send(followingFeed)
  },
)

//5 get follower names

app.get(
  '/user/followers/',
  authenticateToken,
  getUserId,
  async (request, response) => {
    const followingId = `select user.name
                      from user
                      join follower 
                      on user.user_id=follower.follower_user_id
                      where follower.following_user_id=${userId};`
    const followingFeed = await db.all(followingId)
    response.send(followingFeed)
  },
)

//6 get following tweets by tweet id
app.get(
  '/tweets/:tweetId/',
  authenticateToken,
  getUserId,
  async (request, response) => {
    const {tweetId} = request.params
    const followingTweetQuery = `select tweet.tweet,
                            case when count(like.like_id) = null then 0 else count(like.like_id) end as likes,
                            case when count(reply.reply_id) = null then 0 else count(reply.reply_id) end as replies,
                            tweet.date_time as dateTime
                            from tweet
                            join follower on tweet.user_id=follower.following_user_id
                            join reply on tweet.tweet_id=reply.tweet_id 
                            join like on tweet.tweet_id=like.tweet_id
                            where follower.follower_user_id=${userId} and tweet.tweet_id=${tweetId};`
    const followingTweet = await db.get(followingTweetQuery)
    if (followingTweet.tweet !== null) {
      response.send(followingTweet)
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

//7 return tweet likes
app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  getUserId,
  async (request, response) => {
    const {tweetId} = request.params

    const tweetLikesQuery = `select user.username
                            from user
                            join like on user.user_id=like.user_id
                            join tweet on like.tweet_id=tweet.tweet_id
                            join follower on tweet.user_id=follower.following_user_id 
                            where follower.follower_user_id=${userId} and tweet.tweet_id=${tweetId}
                            order by user.user_id;`
    const tweetLikes = await db.all(tweetLikesQuery)
    let likes = []
    for (let user of tweetLikes) {
      likes.push(user.username)
    }

    if (tweetLikes.length > 0) {
      response.send({likes})
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

//8 return tweet replies
app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  getUserId,
  async (request, response) => {
    const {tweetId} = request.params

    const followingTweet = `select user.name , reply.reply
                            from user
                            join reply on user.user_id=reply.user_id
                            join tweet on reply.tweet_id=tweet.tweet_id
                            join follower on tweet.user_id=follower.following_user_id 
                            where follower.follower_user_id=${userId} and tweet.tweet_id=${tweetId};`
    const replies = await db.all(followingTweet)
    if (replies.length > 0) {
      response.send({replies})
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

//9 return user tweets
app.get(
  '/user/tweets/',
  authenticateToken,
  getUserId,
  async (request, response) => {
    const userTweets = `select tweet.tweet,
                            case when count(like.like_id) = null then 0 else count(like.like_id) end as likes,
                            case when count(reply.reply_id) = null then 0 else count(reply.reply_id) end as replies,
                            tweet.date_time as dateTime
                            from tweet
                            left join reply on tweet.tweet_id=reply.tweet_id 
                            left join like on tweet.tweet_id=like.tweet_id
                            where tweet.user_id=${userId}
                            group by tweet.tweet_id;`
    const tweets = await db.all(userTweets)
    response.send(tweets)
  },
)

//10 add tweet
app.post(
  '/user/tweets/',
  authenticateToken,
  getUserId,
  async (request, response) => {
    const {tweet} = request.body
    const postTweet = `insert into tweet(tweet, user_id)
                      values ('${tweet}',${userId});`
    await db.run(postTweet)
    response.send('Created a Tweet')
  },
)

//11 delete tweet

app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  getUserId,
  async (request, response) => {
    const {tweetId} = request.params
    const postTweet = `delete from tweet where tweet_id=${tweetId} and user_id=${userId};`
    const tweetUser = await db.run(postTweet)
    if (tweetUser.changes === 0) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      response.send('Tweet Removed')
    }
  },
)
