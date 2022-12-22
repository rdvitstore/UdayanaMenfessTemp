const Twit = require("twit");
const fs = require("fs");

const { downloadMedia } = require("./download");

class TwitterBot {
  constructor(props) {
    this.T = new Twit({
      consumer_key: props.consumer_key,
      consumer_secret: props.consumer_secret,
      access_token: props.access_token,
      access_token_secret: props.access_token_secret,
    });
    this.triggerWord = props.triggerWord;
  }

  getAdminUserInfo = () => {
    return new Promise((resolve, reject) => {
      this.T.get("account/verify_credentials", { skip_status: true })
        .then((result) => {
          const userId = result.data.id_str;
          resolve(userId);
        })
        .catch((err) => {
          console.log("error on get admin <<<<<<<<<<<<<<");
          reject(err);
        });
    });
  };

  getReceivedMessages = (messages, userId) => {
    return messages.filter((msg) => msg.message_create.sender_id !== userId);
  };

  getUnnecessaryMessages = (receivedMessages, trigger) => {
    return receivedMessages.filter((msg) => {
      const message = msg.message_create.message_data.text; // 'Halo nama gw yoga coy!'
      const words = this.getEachWord(message); // ['Halo', 'nama', 'gw', 'yoga', 'coy!']
      // console.log(!words.includes(trigger));
      // return !words.includes(trigger);

      const splitTrigger = trigger.split(" ");
      let ada = false;
      let tidakAda = false;

      splitTrigger.map((data) => {
        if (!words.includes(data)) {
          tidakAda = true;
        } else {
          ada = true;
        }
      });

      if (ada && tidakAda) {
        return false;
      } else {
        return true;
      }
    });
  };

  getTriggerMessages = (receivedMessages, trigger) => {
    return receivedMessages.filter((msg) => {
      const message = msg.message_create.message_data.text; // 'Halo nama gw yoga coy!'
      const words = this.getEachWord(message); // ['Halo', 'nama', 'gw', 'yoga', 'coy!']
      // console.log(words.includes(trigger));
      // return words.includes(trigger);

      const splitTrigger = trigger.split(" ");
      let ada = false;
      let tidakAda = false;

      splitTrigger.map((data) => {
        if (words.includes(data)) {
          ada = true;
        } else {
          tidakAda = true;
        }
      });

      if (ada && tidakAda) {
        return true;
      } else {
        return false;
      }
    });
  };

  getEachWord = (message) => {
    let words = []; // ['ini', 'line,', 'pertama', 'ini', ...]
    let finalWords = []; // ['ini', 'line', ',', 'pertama', ....]
    const separateEnter = message.split("\n"); // ['ini line, pertama', 'ini line kedua']
    separateEnter.forEach((line) => (words = [...words, ...line.split(" ")]));
    words.forEach((word) => {
      const splitComma = word.split(","); // ['line', ',']
      finalWords = [...finalWords, ...splitComma];
    });
    return finalWords;
  };

  getDirectMessage = (userId) => {
    return new Promise((resolve, reject) => {
      this.T.get("direct_messages/events/list", async (error, data) => {
        try {
          if (!error) {
            const messages = data.events;
            // this.T.get(
            //   "followers/ids",
            //   { screen_name: "need_response" },
            //   function (err, data, response) {
            //     console.log(data.ids.length);
            //   }
            // );
            const receivedMessages = this.getReceivedMessages(messages, userId);
            const unnecessaryMessages = this.getUnnecessaryMessages(
              receivedMessages,
              this.triggerWord
            );
            const triggerMessages = this.getTriggerMessages(
              receivedMessages,
              this.triggerWord
            );

            await this.deleteUnnecessaryMessages(unnecessaryMessages);
            await this.deleteMoreThan280CharMsgs(triggerMessages);
            await this.deleteDMIncludeForbiddenWord(triggerMessages);
            resolve(triggerMessages);
          } else {
            reject("error on get direct message");
          }
        } catch (error) {
          reject(error);
        }
      });
    });
  };

  uploadMedia = (filePath, type) => {
    return new Promise((resolve, reject) => {
      console.log("Media being uploaded....");
      const b64content = fs.readFileSync(filePath, { encoding: "base64" });
      if (type === "photo") {
        this.T.post(
          "media/upload",
          { media_data: b64content },
          (error, data) => {
            if (!error) {
              resolve(data);
              console.log("Media has been successfuly uploaded....");
            } else {
              fs.unlinkSync(filePath);
              reject(error);
            }
          }
        );
      } else {
        this.T.postMediaChunked({ file_path: filePath }, (error, data) => {
          if (!error) {
            resolve(data);
            console.log("Media has been successfuly uploaded....");
          } else {
            fs.unlinkSync(filePath);
            reject(error);
          }
        });
      }
    });
  };

  tweetMessage = (message) => {
    return new Promise(async (resolve, reject) => {
      try {
        const text = message.message_create.message_data.text;
        const attachment = message.message_create.message_data.attachment;

        const payload = {
          status: text,
        };
        if (attachment) {
          const media = attachment.media;
          const shortUrl = attachment.media.url;
          payload.status = text.split(shortUrl)[0];
          const type = attachment.media.type;
          let mediaUrl = "";
          if (type === "animated_gif") {
            mediaUrl = media.video_info.variants[0].url;
          } else if (type === "video") {
            mediaUrl = media.video_info.variants[0].url.split("?")[0];
          } else {
            mediaUrl = attachment.media.media_url;
          }
          const splittedUrl = mediaUrl.split("/");
          const fileName = splittedUrl[splittedUrl.length - 1];
          await downloadMedia(mediaUrl, fileName);
          const uploadedMedia = await this.uploadMedia(fileName, type);
          fs.unlinkSync(fileName);
          console.log("media has been deleted from local....");
          payload.media_ids = [uploadedMedia.media_id_string];
        }
        console.log(`process updating status with id: ${message.id}`);
        this.T.post("statuses/update", payload, (error, data) => {
          if (!error) {
            console.log(
              `successfuly posting new status with DM id ${message.id}`
            );
            resolve({
              message: `successfuly posting new status with DM id ${message.id}`,
              data,
            });
          } else {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  };

  sendDM = (sender) => {
    // URL Link for twitter endpoint
    const urlLink =
      "https://api.twitter.com/1.1/direct_messages/events/new.json";

    // Generating timestamp
    const ts = Math.floor(new Date().getTime() / 1000);
    const timestamp = ts.toString();

    // Authorization Parameters
    const params = {
      oauth_version: "1.0",
      oauth_consumer_key: process.env.CONSUMER_KEY,
      oauth_token: process.env.ACCESS_TOKEN,
      oauth_timestamp: timestamp,
      oauth_nonce: "ZTBrVlg0Z0tGR3g3eVlQWnFxSWk6MTpjaQ",
      oauth_signature_method: "HMAC-SHA1",
      oauth_signature: "F86h_mhpso4at8lcgw527BLMeU1EapTWm-28tZTVv8__yE4zB5",
    };

    const dataString = `{"event": {"type": "message_create", "message_create": {"target": { "recipient_id": "${sender}"},"message_data": {"text": "Pesan Terkirim ya!"}}}}`;

    const options = {
      url: urlLink,
      headers: {
        Authorization: `OAuth oauth_consumer_key="${params.oauth_consumer_key}", oauth_nonce= ${params.oauth_nonce}, oauth_signature= ${params.oauth_signature}, oauth_signature_method="HMAC-SHA1", oauth_timestamp=${params.oauth_timestamp},oauth_token="${params.oauth_token}", oauth_version=${params.oauth_version}`,
        "Content-type": "application/json",
      },
      body: dataString,
    };

    request.post(options, (error, response, body) => {
      console.log(response.statusCode);
    });
  };

  deleteUnnecessaryMessages = async (unnecessaryMessages) => {
    // if (unnecessaryMessages.length > 3) {
    //   for (let i = 0; i < 3; i++) {
    //     await this.deleteMessage(unnecessaryMessages[i]);
    //     await this.sleep(2000);
    //   }
    // } else {
    //   for (const msg of unnecessaryMessages) {
    //     await this.deleteMessage(msg);
    //     await this.sleep(2000);
    //   }
    // }
    for (let i = 0; i < unnecessaryMessages.length; i++) {
      await this.deleteMessage(unnecessaryMessages[i]);
      await this.sleep(2000);
    }
  };

  deleteMoreThan280CharMsgs = async (triggerMessages) => {
    let moreThan280 = [];

    await triggerMessages.map(async (msg) => {
      let text = msg.message_create.message_data.text;
      const attachment = msg.message_create.message_data.attachment;
      if (attachment) {
        const shortUrl = attachment.media.url;
        text = text.split(shortUrl)[0];
      }
      if (text.length > 280) {
        console.log("DM more than 280 char so it'll delete...");
        moreThan280.push(msg);
        await this.deleteMessage(msg);
        await this.sleep(2000);
      }
    });
    for (const msg of moreThan280) {
      const idx = triggerMessages.indexOf(msg);
      triggerMessages.splice(idx, 1);
    }
  };

  deleteDMIncludeForbiddenWord = async (triggerMessages) => {
    const ForbiddenWord = ["BNI", "BCA", "BRI", "MANDIRI", "BSI"];
    const ForbiddenMessage = [];

    await triggerMessages.map(async (msg) => {
      let text = msg.message_create.message_data.text;
      ForbiddenWord.map(async (word) => {
        if (text.toUpperCase().includes(word)) {
          ForbiddenMessage.push(msg);
          console.log("DM include forbidden word so it'll delete...");
          await this.deleteMessage(msg);
          await this.sleep(2000);
        }
      });
    });
    for (const msg of ForbiddenMessage) {
      const idx = triggerMessages.indexOf(msg);
      triggerMessages.splice(idx, 1);
    }
  };

  deleteMessage = (message) => {
    return new Promise((resolve, reject) => {
      this.T.delete(
        "direct_messages/events/destroy",
        { id: message.id },
        (error, data) => {
          if (!error) {
            const msg = `Message with id: ${message.id} has been successfuly deleted`;
            console.log(msg);
            resolve({
              message: msg,
              data,
            });
          } else {
            reject(error);
          }
        }
      );
    });
  };

  sleep = (time) => new Promise((resolve) => setTimeout(resolve, time));
}

module.exports = { TwitterBot };
