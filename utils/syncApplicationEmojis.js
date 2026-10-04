const fs = require("fs");
const path = require("path");

const API_BASE = "https://discord.com/api/v10";

/**
 * Automatically sync emoji image files with
 * Discord Application Emojis.
 *
 * Supported:
 * PNG, JPEG/JPG, GIF, WEBP
 */
async function syncApplicationEmojis(client) {
    if (!client?.token) {
        throw new Error("[EMOJI SYNC] Bot token is not available.");
    }

    const applicationId = client.application?.id || client.user?.id;

    if (!applicationId) {
        throw new Error("[EMOJI SYNC] Could not determine application ID.");
    }

    /*
     * CHANGE THIS if your emoji files are somewhere else.
     *
     * Example:
     * src/emojis/
     */
    const emojiDirectory = path.join(process.cwd(), "src", "emojis");

    if (!fs.existsSync(emojiDirectory)) {
        console.log(
            `[EMOJI SYNC] Emoji directory does not exist: ${emojiDirectory}`
        );
        return;
    }

    const files = fs.readdirSync(emojiDirectory).filter(file => {
        const ext = path.extname(file).toLowerCase();

        return [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext);
    });

    if (!files.length) {
        console.log("[EMOJI SYNC] No emoji image files found.");
        return;
    }

    console.log(
        `[EMOJI SYNC] Found ${files.length} emoji image(s).`
    );

    /*
     * Get currently uploaded application emojis.
     */
    const existingResponse = await discordRequest(
        `${API_BASE}/applications/${applicationId}/emojis`,
        client.token,
        {
            method: "GET"
        }
    );

    const existingEmojis = existingResponse.items || [];

    const existingByName = new Map(
        existingEmojis.map(emoji => [emoji.name, emoji])
    );

    let uploaded = 0;
    let skipped = 0;
    let failed = 0;

    for (const file of files) {
        try {
            /*
             * Remove extension.
             *
             * Example:
             * success.png -> success
             */
            let name = path.parse(file).name;

            /*
             * Discord emoji names should contain
             * alphanumeric characters and underscores.
             */
            name = name
                .replace(/[^a-zA-Z0-9_]/g, "_")
                .replace(/_+/g, "_");

            /*
             * Discord requires at least 2 characters.
             */
            if (name.length < 2) {
                console.log(
                    `[EMOJI SYNC] Skipping "${file}" - invalid name.`
                );

                skipped++;
                continue;
            }

            /*
             * Keep the name within a safe limit.
             */
            name = name.substring(0, 32);

            /*
             * Don't upload duplicates.
             */
            if (existingByName.has(name)) {
                console.log(
                    `[EMOJI SYNC] Already exists: ${name}`
                );

                skipped++;
                continue;
            }

            const filePath = path.join(emojiDirectory, file);

            const buffer = fs.readFileSync(filePath);

            const extension = path
                .extname(file)
                .toLowerCase();

            const mimeTypes = {
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".gif": "image/gif",
                ".webp": "image/webp"
            };

            const mimeType = mimeTypes[extension];

            if (!mimeType) {
                skipped++;
                continue;
            }

            const base64 = buffer.toString("base64");

            const image = `data:${mimeType};base64,${base64}`;

            console.log(
                `[EMOJI SYNC] Uploading: ${name}`
            );

            const created = await discordRequest(
                `${API_BASE}/applications/${applicationId}/emojis`,
                client.token,
                {
                    method: "POST",
                    body: JSON.stringify({
                        name,
                        image
                    })
                }
            );

            existingByName.set(name, created);

            uploaded++;

            /*
             * Small delay to avoid hammering Discord.
             */
            await sleep(350);
        } catch (error) {
            failed++;

            console.error(
                `[EMOJI SYNC] Failed to upload "${file}":`,
                error.message
            );
        }
    }

    console.log(
        `[EMOJI SYNC] Finished. Uploaded: ${uploaded} | Skipped: ${skipped} | Failed: ${failed}`
    );
}


/**
 * Discord API request helper with
 * basic rate-limit handling.
 */
async function discordRequest(url, token, options = {}) {
    let attempts = 0;

    while (attempts < 5) {
        attempts++;

        const response = await fetch(url, {
            ...options,
            headers: {
                Authorization: `Bot ${token}`,
                "Content-Type": "application/json",
                ...(options.headers || {})
            }
        });

        let data = null;

        try {
            data = await response.json();
        } catch {
            data = null;
        }

        /*
         * Rate limited.
         */
        if (response.status === 429) {
            const retryAfter =
                Number(data?.retry_after || 1) * 1000;

            console.log(
                `[EMOJI SYNC] Rate limited. Waiting ${retryAfter}ms...`
            );

            await sleep(retryAfter);
            continue;
        }

        if (!response.ok) {
            throw new Error(
                `Discord API ${response.status}: ${
                    data?.message ||
                    JSON.stringify(data) ||
                    "Unknown error"
                }`
            );
        }

        return data;
    }

    throw new Error(
        "Discord API request failed after multiple retries."
    );
}


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


module.exports = {
    syncApplicationEmojis
};
