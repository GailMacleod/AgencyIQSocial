import {
  users,
  posts,
  platformConnections,
  brandPurpose,
  verificationCodes,
  giftCertificates,
  giftCertificateActionLog,
  subscriptionAnalytics,
  postLedger,
  postSchedule,
  type User,
  type InsertUser,
  type Post,
  type InsertPost,
  type PlatformConnection,
  type InsertPlatformConnection,
  type BrandPurpose,
  type InsertBrandPurpose,
  type VerificationCode,
  type InsertVerificationCode,
  type GiftCertificate,
  type InsertGiftCertificate,
  type GiftCertificateActionLog,
  type InsertGiftCertificateActionLog,
  type SubscriptionAnalytics,
  type InsertSubscriptionAnalytics,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";

export interface IStorage {
  // User operations - phone UID architecture
  getUser(id: number): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  getUserByPhone(phone: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByStripeSubscriptionId(subscriptionId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, updates: Partial<InsertUser>): Promise<User>;
  updateUserPhone(oldPhone: string, newPhone: string): Promise<User>;
  updateUserStripeInfo(id: number, stripeCustomerId: string, stripeSubscriptionId: string): Promise<User>;
  updateStripeCustomerId(userId: number, stripeCustomerId: string): Promise<User>;

  // Post operations
  getPostsByUser(userId: number): Promise<Post[]>;
  getPostsByUserPaginated(userId: number, limit: number, offset: number): Promise<Post[]>;
  createPost(post: InsertPost): Promise<Post>;
  updatePost(id: number, updates: Partial<InsertPost>): Promise<Post>;
  deletePost(id: number): Promise<void>;
  getPost(postId: number): Promise<Post | undefined>;

  // Platform connection operations
  getPlatformConnectionsByUser(userId: number): Promise<PlatformConnection[]>;
  getPlatformConnection(userId: number, platform: string): Promise<PlatformConnection | undefined>;
  getConnectedPlatforms(userId: number): Promise<{[key: string]: boolean}>;
  createPlatformConnection(connection: InsertPlatformConnection): Promise<PlatformConnection>;
  updatePlatformConnection(id: number, updates: Partial<InsertPlatformConnection>): Promise<PlatformConnection>;
  updatePlatformConnectionByPlatform(userId: number, platform: string, updates: Partial<InsertPlatformConnection>): Promise<PlatformConnection>;
  deletePlatformConnection(id: number): Promise<void>;

  // Brand purpose operations
  getBrandPurposeByUser(userId: number): Promise<BrandPurpose | undefined>;
  createBrandPurpose(brandPurpose: InsertBrandPurpose): Promise<BrandPurpose>;
  updateBrandPurpose(id: number, updates: Partial<InsertBrandPurpose>): Promise<BrandPurpose>;

  // Verification code operations
  createVerificationCode(code: InsertVerificationCode): Promise<VerificationCode>;
  getVerificationCode(phone: string, code: string): Promise<VerificationCode | undefined>;
  markVerificationCodeUsed(id: number): Promise<void>;

  // Gift certificate operations with enhanced user tracking
  createGiftCertificate(certificate: InsertGiftCertificate, createdBy?: number): Promise<GiftCertificate>;
  getGiftCertificate(code: string): Promise<GiftCertificate | undefined>;
  redeemGiftCertificate(code: string, userId: number): Promise<GiftCertificate>;
  getAllGiftCertificates(): Promise<GiftCertificate[]>;
  getGiftCertificatesByCreator(createdBy: number): Promise<GiftCertificate[]>;
  getGiftCertificatesByRedeemer(redeemedBy: number): Promise<GiftCertificate[]>;
  
  // Gift certificate action logging
  logGiftCertificateAction(action: InsertGiftCertificateActionLog): Promise<GiftCertificateActionLog>;
  getGiftCertificateActionLog(certificateId: number): Promise<GiftCertificateActionLog[]>;
  getGiftCertificateActionLogByCode(certificateCode: string): Promise<GiftCertificateActionLog[]>;
  getGiftCertificateActionLogByUser(userId: number): Promise<GiftCertificateActionLog[]>;

  // Platform connection search operations
  getPlatformConnectionsByPlatformUserId(platformUserId: string): Promise<PlatformConnection[]>;

  // Post ledger operations for synchronization
  getPostLedgerByUser(userId: string): Promise<any | undefined>;
  createPostLedger(ledger: any): Promise<any>;
  updatePostLedger(userId: string, updates: any): Promise<any>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    const allUsers = await db.select().from(users);
    return allUsers;
  }

  async getUserByPhone(phone: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.userId, phone));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByStripeSubscriptionId(subscriptionId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.stripeSubscriptionId, subscriptionId));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async updateUser(id: number, updates: Partial<InsertUser>): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async updateUserPhone(oldPhone: string, newPhone: string): Promise<User> {
    // Start transaction to ensure complete data migration
    return await db.transaction(async (tx) => {
      // Update user_id (phone UID) in users table
      const [user] = await tx
        .update(users) 
        .set({ 
          userId: newPhone,
          phone: newPhone,
          updatedAt: new Date() 
        })
        .where(eq(users.userId, oldPhone))
        .returning();

      if (!user) {
        throw new Error(`User with phone ${oldPhone} not found`);
      }

      // Raw SQL for complex foreign key updates to ensure data integrity
      await tx.execute(`
        UPDATE post_ledger 
        SET user_id = '${newPhone}' 
        WHERE user_id = '${oldPhone}'
      `);

      await tx.execute(`
        UPDATE post_schedule 
        SET user_id = '${newPhone}' 
        WHERE user_id = '${oldPhone}'
      `);

      console.log(`Successfully migrated all data from ${oldPhone} to ${newPhone}`);
      return user;
    });
  }

  async updateUserStripeInfo(id: number, stripeCustomerId: string, stripeSubscriptionId: string): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ 
        stripeCustomerId,
        stripeSubscriptionId,
        updatedAt: new Date() 
      })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async updateStripeCustomerId(userId: number, stripeCustomerId: string): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ 
        stripeCustomerId,
        updatedAt: new Date() 
      })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  // Post operations
  async getPostsByUser(userId: number): Promise<Post[]> {
    return await db
      .select()
      .from(posts)
      .where(eq(posts.userId, userId))
      .orderBy(desc(posts.scheduledFor));
  }

  async getPostsByUserPaginated(userId: number, limit: number, offset: number): Promise<Post[]> {
    return await db
      .select()
      .from(posts)
      .where(eq(posts.userId, userId))
      .orderBy(desc(posts.scheduledFor))
      .limit(limit)
      .offset(offset);
  }

  async createPost(insertPost: InsertPost): Promise<Post> {
    const [post] = await db
      .insert(posts)
      .values(insertPost)
      .returning();
    return post;
  }

  async updatePost(id: number, updates: Partial<InsertPost>): Promise<Post> {
    const [post] = await db
      .update(posts)
      .set(updates)
      .where(eq(posts.id, id))
      .returning();
    return post;
  }

  async deletePost(id: number): Promise<void> {
    await db.delete(posts).where(eq(posts.id, id));
  }

  async getPost(postId: number): Promise<Post | undefined> {
    const [post] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, postId));
    return post;
  }

  // Platform connection operations
  async getPlatformConnectionsByUser(userId: number): Promise<PlatformConnection[]> {
    return await db
      .select()
      .from(platformConnections)
      .where(eq(platformConnections.userId, userId));
  }

  async createPlatformConnection(connection: InsertPlatformConnection): Promise<PlatformConnection> {
    const [platformConnection] = await db
      .insert(platformConnections)
      .values(connection)
      .returning();
    return platformConnection;
  }

  async updatePlatformConnection(id: number, updates: Partial<InsertPlatformConnection>): Promise<PlatformConnection> {
    const [platformConnection] = await db
      .update(platformConnections)
      .set(updates)
      .where(eq(platformConnections.id, id))
      .returning();
    return platformConnection;
  }

  // ENHANCED: Update platform connection token after refresh
  async updatePlatformConnectionToken(userId: string, platform: string, accessToken: string, refreshToken: string, expiresAt?: Date): Promise<void> {
    const userIdNum = parseInt(userId);
    
    await db.update(platformConnections)
      .set({
        accessToken,
        refreshToken,
        expiresAt: expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000), // Default 24 hours
        updatedAt: new Date()
      })
      .where(and(
        eq(platformConnections.userId, userIdNum),
        eq(platformConnections.platform, platform)
      ));
    
    console.log(`✅ Database updated for ${platform} (User ${userId}): New token expires at ${expiresAt?.toISOString()}`);
  }

  async getPlatformConnection(userId: number, platform: string): Promise<PlatformConnection | undefined> {
    const [connection] = await db
      .select()
      .from(platformConnections)
      .where(and(
        eq(platformConnections.userId, userId),
        eq(platformConnections.platform, platform)
      ));
    return connection;
  }

  async updatePlatformConnectionByPlatform(userId: number, platform: string, updates: Partial<InsertPlatformConnection>): Promise<PlatformConnection> {
    const [platformConnection] = await db
      .update(platformConnections)
      .set(updates)
      .where(and(
        eq(platformConnections.userId, userId),
        eq(platformConnections.platform, platform)
      ))
      .returning();
    return platformConnection;
  }

  async getConnectedPlatforms(userId: number): Promise<{[key: string]: boolean}> {
    const connections = await db
      .select()
      .from(platformConnections)
      .where(eq(platformConnections.userId, userId));
    
    const connectedPlatforms: {[key: string]: boolean} = {};
    connections.forEach(conn => {
      connectedPlatforms[conn.platform] = conn.isActive || false;
    });
    
    return connectedPlatforms;
  }

  async deletePlatformConnection(id: number): Promise<void> {
    await db.delete(platformConnections).where(eq(platformConnections.id, id));
  }

  // Brand purpose operations
  async getBrandPurposeByUser(userId: number): Promise<BrandPurpose | undefined> {
    const [brandPurposeRecord] = await db
      .select()
      .from(brandPurpose)
      .where(eq(brandPurpose.userId, userId));
    return brandPurposeRecord;
  }

  async createBrandPurpose(insertBrandPurpose: InsertBrandPurpose): Promise<BrandPurpose> {
    const [brandPurposeRecord] = await db
      .insert(brandPurpose)
      .values(insertBrandPurpose)
      .returning();
    return brandPurposeRecord;
  }

  async updateBrandPurpose(id: number, updates: Partial<InsertBrandPurpose>): Promise<BrandPurpose> {
    const [brandPurposeRecord] = await db
      .update(brandPurpose)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(brandPurpose.id, id))
      .returning();
    return brandPurposeRecord;
  }

  // Verification code operations
  async createVerificationCode(insertCode: InsertVerificationCode): Promise<VerificationCode> {
    const [code] = await db
      .insert(verificationCodes)
      .values(insertCode)
      .returning();
    return code;
  }

  async getVerificationCode(phone: string, code: string): Promise<VerificationCode | undefined> {
    const [verificationCode] = await db
      .select()
      .from(verificationCodes)
      .where(
        and(
          eq(verificationCodes.phone, phone),
          eq(verificationCodes.code, code)
        )
      )
      .orderBy(desc(verificationCodes.createdAt))
      .limit(1);
    return verificationCode;
  }

  async markVerificationCodeUsed(id: number): Promise<void> {
    await db
      .update(verificationCodes)
      .set({ verified: true })
      .where(eq(verificationCodes.id, id));
  }

  // Gift certificate operations with enhanced user tracking
  async createGiftCertificate(insertCertificate: InsertGiftCertificate, createdBy?: number): Promise<GiftCertificate> {
    const certificateData = {
      ...insertCertificate,
      createdBy
    };
    
    const [certificate] = await db
      .insert(giftCertificates)
      .values(certificateData)
      .returning();
    
    // Log the creation action
    await this.logGiftCertificateAction({
      certificateId: certificate.id,
      certificateCode: certificate.code,
      actionType: 'created',
      actionBy: createdBy,
      actionDetails: {
        plan: certificate.plan,
        createdFor: certificate.createdFor
      },
      success: true
    });
    
    return certificate;
  }

  async getGiftCertificate(code: string): Promise<GiftCertificate | undefined> {
    const [certificate] = await db
      .select()
      .from(giftCertificates)
      .where(eq(giftCertificates.code, code));
    return certificate || undefined;
  }

  async redeemGiftCertificate(code: string, userId: number): Promise<GiftCertificate> {
    const [certificate] = await db
      .update(giftCertificates)
      .set({ 
        isUsed: true, 
        redeemedBy: userId,
        redeemedAt: new Date()
      })
      .where(eq(giftCertificates.code, code))
      .returning();
    
    // Log the redemption action
    await this.logGiftCertificateAction({
      certificateId: certificate.id,
      certificateCode: certificate.code,
      actionType: 'redeemed',
      actionBy: userId,
      actionDetails: {
        plan: certificate.plan,
        originalCreatedFor: certificate.createdFor
      },
      success: true
    });
    
    return certificate;
  }

  async getAllGiftCertificates(): Promise<GiftCertificate[]> {
    const certificates = await db
      .select()
      .from(giftCertificates)
      .orderBy(desc(giftCertificates.createdAt));
    return certificates;
  }

  async getGiftCertificatesByCreator(createdBy: number): Promise<GiftCertificate[]> {
    const certificates = await db
      .select()
      .from(giftCertificates)
      .where(eq(giftCertificates.createdBy, createdBy))
      .orderBy(desc(giftCertificates.createdAt));
    return certificates;
  }

  async getGiftCertificatesByRedeemer(redeemedBy: number): Promise<GiftCertificate[]> {
    const certificates = await db
      .select()
      .from(giftCertificates)
      .where(eq(giftCertificates.redeemedBy, redeemedBy))
      .orderBy(desc(giftCertificates.redeemedAt));
    return certificates;
  }

  // Gift certificate action logging
  async logGiftCertificateAction(action: InsertGiftCertificateActionLog): Promise<GiftCertificateActionLog> {
    const [logEntry] = await db
      .insert(giftCertificateActionLog)
      .values(action)
      .returning();
    return logEntry;
  }

  async getGiftCertificateActionLog(certificateId: number): Promise<GiftCertificateActionLog[]> {
    const logs = await db
      .select()
      .from(giftCertificateActionLog)
      .where(eq(giftCertificateActionLog.certificateId, certificateId))
      .orderBy(desc(giftCertificateActionLog.createdAt));
    return logs;
  }

  async getGiftCertificateActionLogByCode(certificateCode: string): Promise<GiftCertificateActionLog[]> {
    const logs = await db
      .select()
      .from(giftCertificateActionLog)
      .where(eq(giftCertificateActionLog.certificateCode, certificateCode))
      .orderBy(desc(giftCertificateActionLog.createdAt));
    return logs;
  }

  async getGiftCertificateActionLogByUser(userId: number): Promise<GiftCertificateActionLog[]> {
    const logs = await db
      .select()
      .from(giftCertificateActionLog)
      .where(eq(giftCertificateActionLog.actionBy, userId))
      .orderBy(desc(giftCertificateActionLog.createdAt));
    return logs;
  }

  async getPlatformConnectionsByPlatformUserId(platformUserId: string): Promise<PlatformConnection[]> {
    return await db
      .select()
      .from(platformConnections)
      .where(eq(platformConnections.platformUserId, platformUserId));
  }

  // Post ledger operations for synchronization
  async getPostLedgerByUser(userId: string): Promise<any | undefined> {
    const [ledger] = await db.select().from(postLedger).where(eq(postLedger.userId, userId));
    return ledger;
  }

  async createPostLedger(ledger: any): Promise<any> {
    const [newLedger] = await db
      .insert(postLedger)
      .values(ledger)
      .returning();
    return newLedger;
  }

  async updatePostLedger(userId: string, updates: any): Promise<any> {
    const [updatedLedger] = await db
      .update(postLedger)
      .set(updates)
      .where(eq(postLedger.userId, userId))
      .returning();
    return updatedLedger;
  }
}

export const storage = new DatabaseStorage();
